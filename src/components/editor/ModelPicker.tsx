
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProviderId } from "@/types";
import type { ModelLoaderResult } from "@/lib/ai/model-loader";
import { parseModelId } from "@/lib/ai/providers";

interface ModelPickerProps {
  value: string; // "providerId/modelName" or empty
  onChange: (next: string) => void;
  availableModels: ModelLoaderResult | null;
  loading: boolean;
  configuredProviders: Set<ProviderId>;
}

// Per-persona model picker. Provider goes in a small dropdown; model name is
// a free-text input with an optional "browse" menu that lists models the
// configured provider exposes via its /models endpoint. No model names are
// hardcoded — the browse list is always live.
export default function ModelPicker({
  value,
  onChange,
  availableModels,
  loading,
  configuredProviders,
}: ModelPickerProps) {
  const parsed = parseModelId(value);
  const currentProvider: ProviderId = parsed?.providerId ?? "anthropic";
  const [providerId, setProviderId] = useState<ProviderId>(currentProvider);
  const modelName = parsed?.modelName ?? "";

  const handleProviderChange = (next: string) => {
    const nextProvider = next as ProviderId;
    setProviderId(nextProvider);
    // Preserve any typed model name across provider changes; if empty, clear.
    onChange(modelName ? `${nextProvider}/${modelName}` : "");
  };

  const handleModelNameChange = (next: string) => {
    onChange(next ? `${providerId}/${next.trim()}` : "");
  };

  const providerResult =
    providerId === "anthropic"
      ? availableModels?.anthropic
      : availableModels?.deepseek;

  const browseModels = providerResult?.models ?? [];
  const browseError = providerResult?.error ?? null;
  const providerConfigured = configuredProviders.has(providerId);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Select value={providerId} onValueChange={handleProviderChange}>
          <SelectTrigger className="w-[120px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="deepseek">DeepSeek</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1 flex gap-1">
          <Input
            className="h-8 text-xs font-mono"
            value={modelName}
            placeholder={
              providerId === "anthropic"
                ? "claude-…"
                : "deepseek-…"
            }
            onChange={(e) => handleModelNameChange(e.target.value)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                title="Browse available models"
                disabled={!providerConfigured}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[260px] max-h-[280px] overflow-y-auto">
              <DropdownMenuLabel className="text-xs">
                {providerId === "anthropic" ? "Anthropic" : "DeepSeek"} models
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {!providerConfigured && (
                <DropdownMenuItem disabled>
                  <span className="text-xs text-muted-foreground">
                    Add an API key to load models
                  </span>
                </DropdownMenuItem>
              )}
              {providerConfigured && loading && (
                <DropdownMenuItem disabled>
                  <span className="text-xs text-muted-foreground">Loading…</span>
                </DropdownMenuItem>
              )}
              {providerConfigured && !loading && browseError && (
                <DropdownMenuItem disabled>
                  <span className="text-xs text-destructive">
                    Couldn&apos;t load list — type the model name above
                  </span>
                </DropdownMenuItem>
              )}
              {providerConfigured && !loading && !browseError && browseModels.length === 0 && (
                <DropdownMenuItem disabled>
                  <span className="text-xs text-muted-foreground">No models returned</span>
                </DropdownMenuItem>
              )}
              {browseModels.map((m) => (
                <DropdownMenuItem
                  key={m.modelId}
                  onClick={() => handleModelNameChange(m.modelName)}
                  className="text-xs font-mono"
                >
                  {m.displayName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
