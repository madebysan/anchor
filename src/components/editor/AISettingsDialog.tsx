
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import type {
  AISettings,
  TriggerConfig,
  ContextStrategy,
  ProviderId,
} from "@/types";
import { DEFAULT_TRIGGER_PROMPTS } from "@/lib/settings";
import {
  STRATEGY_LABELS,
  STRATEGY_DESCRIPTIONS,
} from "@/lib/ai/context-router";
import { loadAvailableModels, type ModelLoaderResult } from "@/lib/ai/model-loader";
import ModelPicker from "./ModelPicker";

interface AISettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AISettings;
  onUpdateSettings: (patch: Partial<AISettings>) => void;
  onUpdateTrigger: (key: string, patch: Partial<TriggerConfig>) => void;
  onResetTriggerPrompt: (key: string) => void;
  onAddTrigger: (name: string) => boolean;
  onRemoveTrigger: (key: string) => void;
}

export default function AISettingsDialog({
  open,
  onOpenChange,
  settings,
  onUpdateSettings,
  onUpdateTrigger,
  onResetTriggerPrompt,
  onAddTrigger,
  onRemoveTrigger,
}: AISettingsDialogProps) {
  const triggerEntries = Object.entries(settings.triggers);

  const configuredProviders = new Set<ProviderId>();
  if (settings.anthropicKey) configuredProviders.add("anthropic");
  if (settings.deepseekKey) configuredProviders.add("deepseek");

  // Load model lists live whenever the dialog opens with at least one key set.
  // Failures per-provider are kept in availableModels so the picker can fall
  // back to free-text entry for that provider only.
  const [availableModels, setAvailableModels] = useState<ModelLoaderResult | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!settings.anthropicKey && !settings.deepseekKey) {
      setAvailableModels(null);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    loadAvailableModels({
      anthropicKey: settings.anthropicKey,
      deepseekKey: settings.deepseekKey,
    })
      .then((result) => {
        if (!cancelled) setAvailableModels(result);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, settings.anthropicKey, settings.deepseekKey]);

  const handleAddTrigger = () => {
    let name = "New Trigger";
    let key = "new-trigger";
    let counter = 2;
    while (settings.triggers[key]) {
      name = `New Trigger ${counter}`;
      key = `new-trigger-${counter}`;
      counter++;
    }
    onAddTrigger(name);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure API keys, AI personas, and keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="model" className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="model">API Keys</TabsTrigger>
            <TabsTrigger value="triggers">Personas</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
          </TabsList>

          <TabsContent value="model" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="anthropic-key">Anthropic API Key</Label>
              <Input
                id="anthropic-key"
                type="password"
                placeholder="sk-ant-..."
                value={settings.anthropicKey}
                onChange={(e) => onUpdateSettings({ anthropicKey: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                For Claude models.{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Get a key
                </a>
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="deepseek-key">DeepSeek API Key</Label>
              <Input
                id="deepseek-key"
                type="password"
                placeholder="sk-..."
                value={settings.deepseekKey}
                onChange={(e) => onUpdateSettings({ deepseekKey: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                For DeepSeek models.{" "}
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Get a key
                </a>
              </p>
            </div>

            {!settings.anthropicKey && !settings.deepseekKey && (
              <p className="text-xs text-destructive">
                At least one API key is required to use AI features.
              </p>
            )}
          </TabsContent>

          <TabsContent value="triggers" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Each persona is invoked by typing{" "}
              <code className="bg-muted px-1 rounded">@name</code> at the start of a
              comment. You can change the prompt, the model, and how much of the
              document gets sent.
            </p>

            {triggerEntries.map(([key, config], i) => {
              const hasDefault = key in DEFAULT_TRIGGER_PROMPTS;
              const isModified =
                hasDefault && config.prompt !== DEFAULT_TRIGGER_PROMPTS[key];

              return (
                <div key={key}>
                  {i > 0 && <Separator className="mb-4" />}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Switch
                          checked={config.enabled}
                          onCheckedChange={(checked) =>
                            onUpdateTrigger(key, { enabled: checked })
                          }
                        />
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-mono text-sm text-muted-foreground shrink-0">@</span>
                          <Input
                            className="h-7 text-sm font-medium"
                            value={config.name}
                            onChange={(e) => onUpdateTrigger(key, { name: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isModified && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Reset prompt to default"
                            onClick={() => onResetTriggerPrompt(key)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Delete persona"
                          onClick={() => onRemoveTrigger(key)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <Textarea
                      className="text-xs font-mono min-h-[80px] resize-y"
                      value={config.prompt}
                      onChange={(e) => onUpdateTrigger(key, { prompt: e.target.value })}
                      disabled={!config.enabled}
                    />

                    <div className="grid grid-cols-[100px_1fr] items-center gap-3">
                      <Label className="text-xs text-muted-foreground">Model</Label>
                      <ModelPicker
                        value={config.modelId}
                        onChange={(next) => onUpdateTrigger(key, { modelId: next })}
                        availableModels={availableModels}
                        loading={loadingModels}
                        configuredProviders={configuredProviders}
                      />
                    </div>

                    <div className="grid grid-cols-[100px_1fr] items-center gap-3">
                      <Label className="text-xs text-muted-foreground">Context</Label>
                      <Select
                        value={config.contextStrategy}
                        onValueChange={(next) =>
                          onUpdateTrigger(key, { contextStrategy: next as ContextStrategy })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(STRATEGY_LABELS).map(([k, label]) => (
                            <SelectItem key={k} value={k} className="text-xs">
                              <div className="flex flex-col gap-0.5">
                                <span>{label}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {STRATEGY_DESCRIPTIONS[k as ContextStrategy]}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })}

            <Button variant="outline" size="sm" className="w-full" onClick={handleAddTrigger}>
              <Plus className="h-4 w-4 mr-2" />
              Add Persona
            </Button>
          </TabsContent>

          <TabsContent value="shortcuts" className="mt-4">
            <div className="rounded-lg border p-4 space-y-3">
              <h4 className="text-sm font-medium">Keyboard Shortcuts</h4>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Submit message</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">
                    Cmd + Enter
                  </kbd>
                </div>
              </div>

              <Separator />

              <h4 className="text-sm font-medium">Persona Triggers</h4>
              <p className="text-xs text-muted-foreground">
                Type these at the start of a comment to invoke a persona.
              </p>
              <div className="grid gap-2 text-sm">
                {triggerEntries
                  .filter(([, config]) => config.enabled)
                  .map(([key, config]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-muted-foreground">{config.name}</span>
                      <code className="px-2 py-0.5 bg-muted rounded text-xs font-mono">
                        @{key}
                      </code>
                    </div>
                  ))}
              </div>

              <Separator />

              <p className="text-xs text-muted-foreground">
                You can add instructions after a trigger, e.g.{" "}
                <code className="bg-muted px-1 rounded">@copywriter make it punchier</code>
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
