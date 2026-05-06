
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

interface SetupScreenProps {
  onComplete: (keys: { anthropicKey: string; deepseekKey: string }) => void;
}

export default function SetupScreen({ onComplete }: SetupScreenProps) {
  const [anthropicKey, setAnthropicKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");

  // At least one key required. We don't validate the format strictly — keys
  // can change over time and providers may add new prefixes. The first failed
  // request will surface a clear "invalid key" error in-app.
  const isValid = anthropicKey.trim().length > 0 || deepseekKey.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid) {
      onComplete({
        anthropicKey: anthropicKey.trim(),
        deepseekKey: deepseekKey.trim(),
      });
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 px-8 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">InlineAI</h1>
            <p className="text-sm text-muted-foreground">
              AI-powered comments in the margins of your writing
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="setup-anthropic-key">Anthropic API Key</Label>
              <Input
                id="setup-anthropic-key"
                type="password"
                placeholder="sk-ant-..."
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                autoFocus
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

            <div className="space-y-2">
              <Label htmlFor="setup-deepseek-key">DeepSeek API Key</Label>
              <Input
                id="setup-deepseek-key"
                type="password"
                placeholder="sk-..."
                value={deepseekKey}
                onChange={(e) => setDeepseekKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Optional. For DeepSeek models.{" "}
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

            <p className="text-xs text-muted-foreground">
              Either key gets you started. Keys are stored locally in your browser
              and sent only to their respective providers.
            </p>

            <Button type="submit" className="w-full" disabled={!isValid}>
              Get Started
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
