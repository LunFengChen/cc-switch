//! Provider failure classification for generic failover.
//!
//! This layer intentionally stays provider-agnostic: provider-specific adapters can still
//! normalize upstream responses, while the forwarder gets one compact decision for logging,
//! circuit breaker accounting, and whether trying the next provider is useful.

use super::ProxyError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderFailureKind {
    RateLimited,
    QuotaExhausted,
    AuthFailed,
    ModelUnavailable,
    ContextTooLarge,
    BadRequest,
    UpstreamServerError,
    NetworkError,
    Timeout,
    StreamInterrupted,
    ProviderConfig,
    Transform,
    NoProvider,
    Unknown,
}

impl ProviderFailureKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RateLimited => "rate_limited",
            Self::QuotaExhausted => "quota_exhausted",
            Self::AuthFailed => "auth_failed",
            Self::ModelUnavailable => "model_unavailable",
            Self::ContextTooLarge => "context_too_large",
            Self::BadRequest => "bad_request",
            Self::UpstreamServerError => "upstream_server_error",
            Self::NetworkError => "network_error",
            Self::Timeout => "timeout",
            Self::StreamInterrupted => "stream_interrupted",
            Self::ProviderConfig => "provider_config",
            Self::Transform => "transform",
            Self::NoProvider => "no_provider",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderFailureClassification {
    pub kind: ProviderFailureKind,
    /// Whether the current request may try the next provider.
    pub retryable: bool,
    /// Whether the failure should count against provider health/circuit breaker.
    pub affects_provider_health: bool,
    /// Human-oriented cooldown hint for logs/future UI. This is not enforced yet.
    pub cooldown_hint_seconds: Option<u64>,
    pub reason: String,
}

impl ProviderFailureClassification {
    fn new(
        kind: ProviderFailureKind,
        retryable: bool,
        affects_provider_health: bool,
        cooldown_hint_seconds: Option<u64>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            retryable,
            affects_provider_health,
            cooldown_hint_seconds,
            reason: reason.into(),
        }
    }

    pub fn retryable_provider_failure(
        kind: ProviderFailureKind,
        cooldown_hint_seconds: Option<u64>,
        reason: impl Into<String>,
    ) -> Self {
        Self::new(kind, true, true, cooldown_hint_seconds, reason)
    }

    pub fn non_retryable_client_failure(
        kind: ProviderFailureKind,
        reason: impl Into<String>,
    ) -> Self {
        Self::new(kind, false, false, None, reason)
    }

    pub fn terminal(kind: ProviderFailureKind, reason: impl Into<String>) -> Self {
        Self::new(kind, false, false, None, reason)
    }

    pub fn log_fields(&self) -> String {
        let cooldown = self
            .cooldown_hint_seconds
            .map(|seconds| format!(", cooldown_hint={}s", seconds))
            .unwrap_or_default();
        format!(
            "kind={}, retryable={}, affects_health={}{}",
            self.kind.as_str(),
            self.retryable,
            self.affects_provider_health,
            cooldown
        )
    }
}

pub fn classify_provider_failure(error: &ProxyError) -> ProviderFailureClassification {
    match error {
        ProxyError::Timeout(_) => ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::Timeout,
            Some(30),
            "request timeout",
        ),
        ProxyError::StreamIdleTimeout(_) => {
            ProviderFailureClassification::retryable_provider_failure(
                ProviderFailureKind::StreamInterrupted,
                Some(30),
                "stream idle timeout",
            )
        }
        ProxyError::ForwardFailed(message) => {
            let kind = if looks_like_network_error(message) {
                ProviderFailureKind::NetworkError
            } else {
                ProviderFailureKind::Unknown
            };
            ProviderFailureClassification::retryable_provider_failure(
                kind,
                Some(30),
                "forward failed",
            )
        }
        ProxyError::ProviderUnhealthy(_) => {
            ProviderFailureClassification::retryable_provider_failure(
                ProviderFailureKind::Unknown,
                Some(60),
                "provider marked unhealthy",
            )
        }
        ProxyError::UpstreamError { status, body } => {
            classify_upstream_error(*status, body.as_deref())
        }
        ProxyError::ConfigError(_) => ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::ProviderConfig,
            None,
            "provider config error",
        ),
        ProxyError::TransformError(_) => ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::Transform,
            None,
            "provider transform error",
        ),
        ProxyError::AuthError(_) => ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::AuthFailed,
            None,
            "provider auth error",
        ),
        ProxyError::NoAvailableProvider
        | ProxyError::AllProvidersCircuitOpen
        | ProxyError::NoProvidersConfigured
        | ProxyError::MaxRetriesExceeded => ProviderFailureClassification::terminal(
            ProviderFailureKind::NoProvider,
            "no provider available",
        ),
        ProxyError::InvalidRequest(_) => {
            ProviderFailureClassification::non_retryable_client_failure(
                ProviderFailureKind::BadRequest,
                "invalid client request",
            )
        }
        ProxyError::Internal(_) | ProxyError::DatabaseError(_) => {
            ProviderFailureClassification::terminal(
                ProviderFailureKind::Unknown,
                "proxy internal error",
            )
        }
        ProxyError::AlreadyRunning
        | ProxyError::NotRunning
        | ProxyError::BindFailed(_)
        | ProxyError::StopTimeout
        | ProxyError::StopFailed(_) => ProviderFailureClassification::terminal(
            ProviderFailureKind::Unknown,
            "proxy lifecycle error",
        ),
    }
}

fn classify_upstream_error(status: u16, body: Option<&str>) -> ProviderFailureClassification {
    let body_text = body.map(extract_searchable_error_text).unwrap_or_default();
    let lower = body_text.to_lowercase();

    if has_any(&lower, QUOTA_KEYWORDS) {
        return ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::QuotaExhausted,
            Some(6 * 60 * 60),
            "quota/balance exhausted",
        );
    }

    if status == 429 || has_any(&lower, RATE_LIMIT_KEYWORDS) {
        return ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::RateLimited,
            Some(120),
            "rate limited",
        );
    }

    if has_any(&lower, CONTEXT_KEYWORDS) || matches!(status, 413) {
        return ProviderFailureClassification::non_retryable_client_failure(
            ProviderFailureKind::ContextTooLarge,
            "request context/payload too large",
        );
    }

    if has_any(&lower, MODEL_KEYWORDS) || status == 404 {
        return ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::ModelUnavailable,
            None,
            "model or upstream path unavailable",
        );
    }

    if matches!(status, 401 | 403) {
        return ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::AuthFailed,
            None,
            "upstream authentication/authorization failed",
        );
    }

    if (500..=599).contains(&status) {
        return ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::UpstreamServerError,
            Some(60),
            "upstream server error",
        );
    }

    if matches!(status, 408 | 409 | 425 | 451) {
        return ProviderFailureClassification::retryable_provider_failure(
            ProviderFailureKind::UpstreamServerError,
            Some(30),
            "retryable upstream status",
        );
    }

    if matches!(status, 400 | 405 | 406 | 414 | 415 | 422 | 501) {
        return ProviderFailureClassification::non_retryable_client_failure(
            ProviderFailureKind::BadRequest,
            "client request rejected by upstream",
        );
    }

    ProviderFailureClassification::retryable_provider_failure(
        ProviderFailureKind::Unknown,
        Some(30),
        "unclassified upstream error",
    )
}

fn extract_searchable_error_text(body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        let mut parts = Vec::new();
        collect_json_error_text(&value, &mut parts);
        if !parts.is_empty() {
            return parts.join(" ");
        }
    }
    body.to_string()
}

fn collect_json_error_text(value: &Value, parts: &mut Vec<String>) {
    match value {
        Value::String(text) => parts.push(text.clone()),
        Value::Array(items) => {
            for item in items {
                collect_json_error_text(item, parts);
            }
        }
        Value::Object(map) => {
            for key in [
                "message",
                "code",
                "type",
                "error",
                "detail",
                "reason",
                "error_code",
                "errorType",
            ] {
                if let Some(next) = map.get(key) {
                    collect_json_error_text(next, parts);
                }
            }
        }
        _ => {}
    }
}

fn has_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn looks_like_network_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    has_any(
        &lower,
        &[
            "connection reset",
            "connection refused",
            "connection closed",
            "connection aborted",
            "dns",
            "tcp",
            "tls",
            "broken pipe",
            "eof",
            "network",
        ],
    )
}

const QUOTA_KEYWORDS: &[&str] = &[
    "insufficient_quota",
    "insufficient_user_quota",
    "quota exceeded",
    "quota_exceeded",
    "quota exhausted",
    "usage limit",
    "usage_limit",
    "credit balance",
    "balance not enough",
    "insufficient balance",
    "billing hard limit",
    "out of credits",
    "余额不足",
    "额度不足",
    "额度已用尽",
    "今日额度",
    "账户额度",
    "账号额度",
];

const RATE_LIMIT_KEYWORDS: &[&str] = &[
    "rate_limit_exceeded",
    "rate limit",
    "rate limited",
    "too many requests",
    "requests per",
    "rpm",
    "tpm",
    "请求过多",
    "频率限制",
    "限流",
];

const MODEL_KEYWORDS: &[&str] = &[
    "model_not_found",
    "model not found",
    "model unavailable",
    "model does not exist",
    "unsupported model",
    "unknown model",
    "模型不存在",
    "模型不可用",
    "不支持的模型",
];

const CONTEXT_KEYWORDS: &[&str] = &[
    "context_length_exceeded",
    "context length",
    "maximum context",
    "too many tokens",
    "token limit",
    "payload too large",
    "request entity too large",
    "上下文",
    "token 超限",
    "令牌超限",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_openai_quota_as_retryable_provider_failure() {
        let error = ProxyError::UpstreamError {
            status: 429,
            body: Some(r#"{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}"#.to_string()),
        };

        let classified = classify_provider_failure(&error);

        assert_eq!(classified.kind, ProviderFailureKind::QuotaExhausted);
        assert!(classified.retryable);
        assert!(classified.affects_provider_health);
        assert_eq!(classified.cooldown_hint_seconds, Some(6 * 60 * 60));
    }

    #[test]
    fn classify_gateway_balance_error_even_when_status_400() {
        let error = ProxyError::UpstreamError {
            status: 400,
            body: Some("余额不足，请充值".to_string()),
        };

        let classified = classify_provider_failure(&error);

        assert_eq!(classified.kind, ProviderFailureKind::QuotaExhausted);
        assert!(classified.retryable);
    }

    #[test]
    fn classify_bad_request_as_non_retryable_client_failure() {
        let error = ProxyError::UpstreamError {
            status: 400,
            body: Some(r#"{"error":{"message":"invalid request body"}}"#.to_string()),
        };

        let classified = classify_provider_failure(&error);

        assert_eq!(classified.kind, ProviderFailureKind::BadRequest);
        assert!(!classified.retryable);
        assert!(!classified.affects_provider_health);
    }

    #[test]
    fn classify_context_limit_as_non_retryable() {
        let error = ProxyError::UpstreamError {
            status: 400,
            body: Some(r#"{"error":{"message":"context_length_exceeded"}}"#.to_string()),
        };

        let classified = classify_provider_failure(&error);

        assert_eq!(classified.kind, ProviderFailureKind::ContextTooLarge);
        assert!(!classified.retryable);
    }

    #[test]
    fn classify_auth_as_retryable_for_next_provider() {
        let error = ProxyError::UpstreamError {
            status: 401,
            body: Some("invalid api key".to_string()),
        };

        let classified = classify_provider_failure(&error);

        assert_eq!(classified.kind, ProviderFailureKind::AuthFailed);
        assert!(classified.retryable);
        assert!(classified.affects_provider_health);
    }
}
