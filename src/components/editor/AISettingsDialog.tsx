import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "next-themes";
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
import { FolderOpen, Plus, RotateCcw, Trash2 } from "lucide-react";
import type {
  AISettings,
  TriggerConfig,
  ContextStrategy,
} from "@/types";
import { DEFAULT_TRIGGER_PROMPTS } from "@/lib/settings";
import {
  STRATEGY_LABELS,
  STRATEGY_DESCRIPTIONS,
  VISIBLE_STRATEGIES,
} from "@/lib/ai/context-router";
import {
  LINE_HEIGHT_OPTIONS,
  SIZE_OPTIONS,
  type LineHeightOption,
  type SizeOption,
} from "@/lib/editor-preferences";

const APP_VERSION = "0.1.0";

interface AISettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AISettings;
  onUpdateSettings: (patch: Partial<AISettings>) => void;
  onUpdateTrigger: (key: string, patch: Partial<TriggerConfig>) => void;
  onResetTriggerPrompt: (key: string) => void;
  onAddTrigger: (name: string) => boolean;
  onRemoveTrigger: (key: string) => void;
  notesFolder?: string;
  onChangeNotesFolder?: () => void;
  currentSize?: SizeOption;
  currentLineHeight?: LineHeightOption;
  onSizeChange?: (id: string) => void;
  onLineHeightChange?: (id: string) => void;
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
  notesFolder,
  onChangeNotesFolder,
  currentSize,
  currentLineHeight,
  onSizeChange,
  onLineHeightChange,
}: AISettingsDialogProps) {
  const triggerEntries = Object.entries(settings.triggers);
  const enabledTriggers = triggerEntries.filter(([, c]) => c.enabled);
  const { theme, setTheme } = useTheme();

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

  const handleRevealFolder = () => {
    if (!notesFolder) return;
    invoke<void>("open_path", { path: notesFolder }).catch((e) => {
      console.error("open_path failed:", e);
    });
  };

  const handleResetSettings = () => {
    if (!window.confirm("Reset all personas, default persona, and editor preferences? Notes folder is kept.")) {
      return;
    }
    try {
      for (const key of [
        "anchor-settings",
        "anchor-editor-prefs",
        "anchor-expanded-folders",
        "inline-md-settings",
        "inline-md-editor-prefs",
        "inline-md-expanded-folders",
      ]) {
        localStorage.removeItem(key);
      }
      window.location.reload();
    } catch (e) {
      console.error("reset failed:", e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            General preferences, AI personas, and keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="triggers">Personas</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
          </TabsList>

          {/* ----- GENERAL ----- */}
          <TabsContent value="general" className="space-y-5 mt-4">
            {/* Notes folder */}
            <section className="space-y-2">
              <Label className="text-xs">Notes folder</Label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs font-mono">
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 min-w-0" title={notesFolder}>
                  {notesFolder || "(not set)"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRevealFolder}
                  disabled={!notesFolder}
                >
                  Reveal in Finder
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onChangeNotesFolder}
                  disabled={!onChangeNotesFolder}
                >
                  Change folder…
                </Button>
              </div>
            </section>

            <Separator />

            {/* Appearance */}
            <section className="space-y-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Appearance</h3>

              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <Label className="text-xs">Theme</Label>
                <Select value={theme || "system"} onValueChange={setTheme}>
                  <SelectTrigger className="h-8 text-xs" aria-label="Theme">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system" className="text-xs">System</SelectItem>
                    <SelectItem value="light" className="text-xs">Light</SelectItem>
                    <SelectItem value="dark" className="text-xs">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <Label className="text-xs">Default size</Label>
                <Select
                  value={currentSize?.id ?? SIZE_OPTIONS[2].id}
                  onValueChange={(next) => onSizeChange?.(next)}
                  disabled={!onSizeChange}
                >
                  <SelectTrigger className="h-8 text-xs" aria-label="Default size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size.id} value={size.id} className="text-xs">
                        {size.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <Label className="text-xs">Line height</Label>
                <Select
                  value={currentLineHeight?.id ?? LINE_HEIGHT_OPTIONS[1].id}
                  onValueChange={(next) => onLineHeightChange?.(next)}
                  disabled={!onLineHeightChange}
                >
                  <SelectTrigger className="h-8 text-xs" aria-label="Line height">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINE_HEIGHT_OPTIONS.map((lineHeight) => (
                      <SelectItem key={lineHeight.id} value={lineHeight.id} className="text-xs">
                        {lineHeight.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            <Separator />

            {/* About */}
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">About</h3>
              <p className="text-xs text-muted-foreground">
                Anchor v{APP_VERSION} · Made by{" "}
                <a
                  href="https://santiagoalonso.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  santiagoalonso.com
                </a>
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetSettings}
                className="text-destructive hover:text-destructive"
              >
                Reset all settings…
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Resets personas, default persona, and editor preferences. Your notes folder and the files in it are not touched.
              </p>
            </section>
          </TabsContent>

          {/* ----- PERSONAS ----- */}
          <TabsContent value="triggers" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Each persona is invoked by typing{" "}
              <code className="bg-muted px-1 rounded">@name</code> at the start of a
              comment. Edit the prompt or change how much of the document gets sent.
              Anchor uses your local Claude Code CLI for every persona.
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
                <SelectTrigger className="h-8 text-xs" aria-label="Default persona">
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
                        <SelectTrigger
                          className="h-8 text-xs"
                          aria-label={`${config.name} context strategy`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {VISIBLE_STRATEGIES.map((k) => (
                            <SelectItem key={k} value={k} className="text-xs">
                              <div className="flex flex-col gap-0.5">
                                <span>{STRATEGY_LABELS[k]}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {STRATEGY_DESCRIPTIONS[k]}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-[100px_1fr] items-center gap-3">
                      <Label className="text-xs text-muted-foreground">Mode</Label>
                      <Select
                        value={config.mode}
                        onValueChange={(next) =>
                          onUpdateTrigger(key, {
                            mode: next === "feedback" ? "feedback" : "rewrite",
                          })
                        }
                      >
                        <SelectTrigger
                          className="h-8 text-xs"
                          aria-label={`${config.name} mode`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rewrite" className="text-xs">
                            Rewrite selected text
                          </SelectItem>
                          <SelectItem value="feedback" className="text-xs">
                            Feedback only
                          </SelectItem>
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

          {/* ----- SHORTCUTS ----- */}
          <TabsContent value="shortcuts" className="mt-4">
            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="text-sm font-medium">Keyboard Shortcuts</h3>
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
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Toggle focus mode</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">⌘ ⇧ M</kbd>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Open Settings</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">⌘ /</kbd>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">New document</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">⌘ N</kbd>
                </div>
              </div>

              <Separator />

              <h3 className="text-sm font-medium">Persona Triggers</h3>
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
