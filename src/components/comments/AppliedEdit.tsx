import type { AppliedEdit as AppliedEditType } from "@/types";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

interface AppliedEditProps {
  edit: AppliedEditType;
  onRevert?: () => void;
}

export default function AppliedEdit({ edit, onRevert }: AppliedEditProps) {
  const isReverted = edit.status === "reverted";

  return (
    <div className="rounded-md border border-border bg-background p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {isReverted ? "Edit reverted" : "Applied edit"}
        </p>
        {!isReverted && onRevert && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onRevert}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Revert
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <section aria-label="Before">
          <p className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            Before
          </p>
          <p className="rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-xs leading-relaxed text-foreground">
            {edit.originalText}
          </p>
        </section>

        <section aria-label="After">
          <p className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            After
          </p>
          <p className="rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-xs leading-relaxed text-foreground">
            {edit.replacementText}
          </p>
        </section>
      </div>
    </div>
  );
}
