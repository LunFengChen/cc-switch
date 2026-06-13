import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ListTree, RefreshCw } from "lucide-react";
import type { AppId } from "@/lib/api";
import type { RequestLog } from "@/types/usage";
import { Button } from "@/components/ui/button";
import { useRequestLogs, useUsageSummary } from "@/lib/query/usage";
import { useUsageEventBridge } from "@/hooks/useUsageEventBridge";
import { cn } from "@/lib/utils";

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCost(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: parsed < 1 ? 4 : 2,
  }).format(parsed);
}

function formatLogLine(log: RequestLog): string {
  const status = log.statusCode > 0 ? log.statusCode : "ERR";
  const model = log.requestModel || log.model || "-";
  const tokens =
    log.inputTokens +
    log.outputTokens +
    log.cacheCreationTokens +
    log.cacheReadTokens;

  return `${formatTime(log.createdAt)} · ${log.providerName || log.providerId} · ${status} · ${model} · ${tokens} tok · ${log.latencyMs}ms · ${formatCost(log.totalCostUsd)}`;
}

function statusClassName(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return "text-emerald-500";
  if (statusCode >= 400) return "text-red-500";
  return "text-amber-500";
}

function formatUsdPerMillion(
  cost: string | undefined,
  tokens: number | undefined,
): string {
  const parsedCost = Number(cost ?? "0");
  const totalTokens = tokens ?? 0;
  if (!Number.isFinite(parsedCost) || totalTokens <= 0) return "--";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format((parsedCost / totalTokens) * 1_000_000);
}

export function ForwardLogDock({
  activeApp,
  visible,
  onOpenUsage,
}: {
  activeApp: AppId;
  visible: boolean;
  onOpenUsage?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useUsageEventBridge();

  const { data, isLoading, refetch } = useRequestLogs({
    filters: { appType: activeApp },
    range: { preset: "today" },
    page: 0,
    pageSize: 12,
    options: { refetchInterval: 5000 },
  });
  const { data: summary } = useUsageSummary({ preset: "today" }, activeApp, {
    refetchInterval: 5000,
  });

  const logs = data?.data ?? [];
  const avgUsdPerMillion = formatUsdPerMillion(
    summary?.totalCost,
    summary?.realTotalTokens,
  );
  const latestLine = useMemo(() => {
    if (isLoading && logs.length === 0) return "正在加载转发日志...";
    if (logs.length === 0) return "暂无今日转发日志";
    return formatLogLine(logs[0]);
  }, [isLoading, logs]);

  if (!visible) return null;

  return (
    <section className="mx-6 mb-2 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-xl">
      <div className="flex h-10 items-center gap-2 px-3 text-xs">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg"
          onClick={() => setExpanded((value) => !value)}
          title={expanded ? "收起转发日志" : "展开转发日志"}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </Button>

        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-muted/60">
          <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="shrink-0 font-medium">转发日志</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {latestLine}
        </span>
        <span
          className="hidden shrink-0 rounded-md bg-muted/60 px-2 py-1 text-[11px] font-medium text-emerald-500 sm:inline-flex"
          title="今日总成本 / 今日总处理 Tokens × 1,000,000；包含缓存命中后的综合均价"
        >
          均价 {avgUsdPerMillion}/1M
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg"
          disabled={isLoading}
          onClick={() => void refetch()}
          title="刷新转发日志"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
          />
        </Button>
        {onOpenUsage && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-lg px-2 text-xs"
            onClick={onOpenUsage}
          >
            详情
          </Button>
        )}
      </div>

      <div
        className={cn(
          "border-t border-border/70 transition-[height] duration-200 ease-out",
          expanded ? "h-52" : "h-0",
        )}
      >
        <div className="h-full overflow-auto bg-background/40 px-3 py-2 text-[11px] leading-6">
          {logs.length === 0 ? (
            <div className="text-muted-foreground">暂无今日转发日志。</div>
          ) : (
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[72px_128px_56px_minmax(140px,1fr)_86px_72px_88px] gap-2 rounded-lg bg-muted/40 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>时间</span>
                <span>供应商</span>
                <span>状态</span>
                <span>模型</span>
                <span>Tokens</span>
                <span>延迟</span>
                <span>成本</span>
              </div>
              <div className="mt-1 space-y-1">
                {logs.map((log) => (
                  <div
                    key={log.requestId}
                    className="grid grid-cols-[72px_128px_56px_minmax(140px,1fr)_86px_72px_88px] gap-2 rounded-lg px-2 py-1 text-foreground/85 transition-colors hover:bg-muted/40"
                    title={log.errorMessage || undefined}
                  >
                    <span className="text-muted-foreground">
                      {formatTime(log.createdAt)}
                    </span>
                    <span className="truncate font-medium">
                      {log.providerName || log.providerId}
                    </span>
                    <span className={statusClassName(log.statusCode)}>
                      {log.statusCode > 0 ? log.statusCode : "ERR"}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {log.requestModel || log.model || "-"}
                    </span>
                    <span className="tabular-nums">
                      {log.inputTokens +
                        log.outputTokens +
                        log.cacheCreationTokens +
                        log.cacheReadTokens}
                    </span>
                    <span className="tabular-nums">{log.latencyMs}ms</span>
                    <span className="tabular-nums text-emerald-500">
                      {formatCost(log.totalCostUsd)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
