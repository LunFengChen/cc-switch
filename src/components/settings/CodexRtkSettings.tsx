import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { settingsApi } from "@/lib/api";
import type { CodexRtkInstallResult } from "@/lib/api/settings";

export function CodexRtkSettings() {
  const [isInstalling, setIsInstalling] = useState(false);
  const [isInstallingHook, setIsInstallingHook] = useState(false);
  const [result, setResult] = useState<CodexRtkInstallResult | null>(null);
  const [hookResult, setHookResult] = useState<string | null>(null);

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      const next = await settingsApi.installCodexRtk();
      setResult(next);
      toast.success("RTK 已写入 Codex 全局配置", { closeButton: true });
    } catch (error) {
      toast.error("RTK 安装/修复失败", { description: String(error) });
    } finally {
      setIsInstalling(false);
    }
  };

  const handleInstallHook = async () => {
    setIsInstallingHook(true);
    try {
      const next = await settingsApi.installRtkHook();
      const detail = [next.stdout, next.stderr].filter(Boolean).join("\n");
      setHookResult(detail || next.command);
      toast.success("RTK Hook 已安装/修复", { closeButton: true });
    } catch (error) {
      toast.error("RTK Hook 安装/修复失败", { description: String(error) });
    } finally {
      setIsInstallingHook(false);
    }
  };

  return (
    <Card className="border-border-default bg-muted/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-primary" />
          Codex RTK
        </CardTitle>
        <CardDescription>
          一键写入全局 AGENTS/RTK 规则，让新项目默认使用 rtk
          grep/git/find/read，避免 rtk bash -lc 低收益记录。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            {isInstalling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                写入中...
              </>
            ) : (
              "一键安装/修复 RTK"
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleInstallHook}
            disabled={isInstallingHook}
          >
            {isInstallingHook ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                安装 Hook 中...
              </>
            ) : (
              "安装 RTK Hook"
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            不卸载现有 Codex 或 RTK；若文件内容不同，会先创建 .bak 备份。
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Codex 本身靠 AGENTS.md/RTK.md 规则生效；Hook 按钮会执行{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            rtk init -g --hook-only --auto-patch
          </code>
          ，用于支持带 Bash hook 的助手（例如 Claude Code）的自动改写/统计。
        </p>

        {result && (
          <div className="space-y-1 rounded-lg border bg-background/60 p-3 text-xs">
            <PathRow label="AGENTS" value={result.agentsPath} />
            <PathRow label="RTK" value={result.rtkPath} />
            {result.rtkVersion && (
              <PathRow label="版本" value={result.rtkVersion} />
            )}
            {result.agentsBackupPath && (
              <PathRow label="AGENTS 备份" value={result.agentsBackupPath} />
            )}
            {result.rtkBackupPath && (
              <PathRow label="RTK 备份" value={result.rtkBackupPath} />
            )}
          </div>
        )}

        {hookResult && (
          <pre className="max-h-28 overflow-auto rounded-lg border bg-background/60 p-3 text-xs whitespace-pre-wrap">
            {hookResult}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[84px_minmax(0,1fr)]">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="truncate font-mono" title={value}>
        {value}
      </span>
    </div>
  );
}
