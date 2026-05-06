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
} from "@/types";
import { DEFAULT_TRIGGER_PROMPTS } from "@/lib/settings";
import {
  STRATEGY_LABELS,
  STRATEGY_DESCRIPTIONS,
} from "@/lib/ai/context-router";

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
  const enabledTriggers = triggerEntries.filter(([, c]) => c.enabled);

  const handleAddTrigger = () => {
    let name = "New Persona";
    let counter = 2;
    let key = "new-persona";
    while (settings.triggers[key]) {
      name = `New Persona ${counter}`;
      key = `new-persona-${counter}`;
      counter++;
    }
    onAddTrigger(name);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure AI personas and keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="triggers" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="triggers">Personas</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
          </TabsList>

          <TabsContent value="triggers" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Each persona is invoked by typing{" "}
              <code className="bg-muted px-1 rounded">@name</code> at the start of a
              comment. Edit the prompt or change how much of the document gets sent.
              Inline MD uses your local Claude Code CLI for every persona.
            </p>

            <div className="grid grid-cols-[140px_1fr] items-center gap-3">
              <Label className="text-xs">Default persona</Label>
              <Select
                value={settings.defaultPersona || "__none__"}
                onValueChange={(next) =>
                  onUpdateSettings({
                    defaultPersona: next === "__none__" ? "" : next,
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">
                    None — untagged comments are plain notes
                  </SelectItem>
                  {enabledTriggers.map(([key]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      @{key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

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
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">Enter</kbd>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">New line in message</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">Shift + Enter</kbd>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Comment on selection</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">⌘ ⇧ V</kbd>
                </div>
              </div>

              <Separator />

              <h4 className="text-sm font-medium">Persona Triggers</h4>
              <p className="text-xs text-muted-foreground">
                Type these at the start of a comment to invoke a persona.
              </p>
              <div className="grid gap-2 text-sm">
                {enabledTriggers.map(([key, config]) => (
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
                Add instructions after a trigger, e.g.{" "}
                <code className="bg-muted px-1 rounded">@copywriter make it punchier</code>.
                Or prefix with <code className="bg-muted px-1 rounded">Note:</code> to skip
                the AI and save as a plain note.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
