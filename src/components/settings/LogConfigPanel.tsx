import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { settingsApi, type LogConfig } from "@/lib/api/settings";

const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"] as const;
const LOG_TAIL_BYTES = 256 * 1024;

export function LogConfigPanel() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<LogConfig>({
    enabled: true,
    level: "info",
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    settingsApi
      .getLogConfig()
      .then(setConfig)
      .catch((e) => console.error("Failed to load log config:", e))
      .finally(() => setIsLoading(false));
  }, []);

  const handleChange = async (updates: Partial<LogConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    try {
      await settingsApi.setLogConfig(newConfig);
    } catch (e) {
      console.error("Failed to save log config:", e);
      toast.error(String(e));
      setConfig(config);
    }
  };

  if (isLoading) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>{t("settings.advanced.logConfig.enabled")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.advanced.logConfig.enabledDescription")}
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(checked) => handleChange({ enabled: checked })}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>{t("settings.advanced.logConfig.level")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.advanced.logConfig.levelDescription")}
          </p>
        </div>
        <Select
          value={config.level}
          disabled={!config.enabled}
          onValueChange={(value) =>
            handleChange({ level: value as LogConfig["level"] })
          }
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOG_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {t(`settings.advanced.logConfig.levels.${level}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 日志级别说明 */}
      <div className="rounded-lg bg-muted/50 p-4 text-xs space-y-1.5">
        <p className="font-medium text-muted-foreground mb-2">
          {t("settings.advanced.logConfig.levelHint")}
        </p>
        <div className="grid gap-1 text-muted-foreground">
          <p>
            <span className="font-mono text-red-500">error</span> -{" "}
            {t("settings.advanced.logConfig.levelDesc.error")}
          </p>
          <p>
            <span className="font-mono text-orange-500">warn</span> -{" "}
            {t("settings.advanced.logConfig.levelDesc.warn")}
          </p>
          <p>
            <span className="font-mono text-blue-500">info</span> -{" "}
            {t("settings.advanced.logConfig.levelDesc.info")}
          </p>
          <p>
            <span className="font-mono text-green-500">debug</span> -{" "}
            {t("settings.advanced.logConfig.levelDesc.debug")}
          </p>
          <p>
            <span className="font-mono text-gray-500">trace</span> -{" "}
            {t("settings.advanced.logConfig.levelDesc.trace")}
          </p>
        </div>
      </div>

      <LogConsole />
    </div>
  );
}

function LogConsole() {
  const [content, setContent] = useState("");
  const [logPath, setLogPath] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [bytesRead, setBytesRead] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const result = await settingsApi.readAppLogTail(LOG_TAIL_BYTES);
      setContent(result.content);
      setLogPath(result.logPath);
      setTruncated(result.truncated);
      setBytesRead(result.bytesRead);
    } catch (e) {
      console.error("Failed to load app log:", e);
      toast.error(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void loadLogs(), 3000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("日志已复制");
    } catch (e) {
      toast.error(`复制失败: ${String(e)}`);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Label>日志控制台</Label>
          <p className="break-all text-xs text-muted-foreground">
            {logPath || "日志文件尚未创建"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            自动刷新
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={() => void loadLogs()}
          >
            {isLoading ? "刷新中..." : "刷新"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!content}
            onClick={() => void handleCopy()}
          >
            复制
          </Button>
        </div>
      </div>

      {truncated && (
        <p className="text-xs text-amber-500">
          当前只显示日志尾部 {Math.ceil(bytesRead / 1024)} KB，避免界面卡顿。
        </p>
      )}

      <pre className="max-h-[420px] overflow-auto rounded-md bg-black/80 p-3 font-mono text-[11px] leading-relaxed text-green-100">
        {content || "暂无日志内容。"}
      </pre>
    </div>
  );
}
