import { Activity, FileText, Play, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Command {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onRunPolicy: () => void;
  onEditPolicy: () => void;
  onViewLedger: () => void;
  runBusy: boolean;
  pendingCount: number;
}

export function CommandPalette({ open, onClose, onRunPolicy, onEditPolicy, onViewLedger, runBusy, pendingCount }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands: Command[] = useMemo(() => [
    {
      id: "run-policy",
      label: "Run Policy",
      description: "Execute the active policy to create a decision plan",
      icon: <Play size={16} />,
      shortcut: "⌘R",
      action: onRunPolicy,
      disabled: runBusy || pendingCount > 0,
    },
    {
      id: "edit-policy",
      label: "Edit Policy",
      description: "Modify the active policy rules",
      icon: <FileText size={16} />,
      shortcut: "⌘E",
      action: onEditPolicy,
    },
    {
      id: "view-ledger",
      label: "View Ledger",
      description: "Scroll to the event evidence section",
      icon: <Activity size={16} />,
      shortcut: "⌘L",
      action: onViewLedger,
    },
  ], [onRunPolicy, onEditPolicy, onViewLedger, runBusy, pendingCount]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const lower = query.toLowerCase();
    return commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(lower) ||
      cmd.description.toLowerCase().includes(lower)
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const executeCommand = useCallback((command: Command) => {
    if (!command.disabled) {
      command.action();
      onClose();
    }
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) executeCommand(cmd);
    } else if (e.key === "Escape") {
      onClose();
    }
  }, [filtered, selectedIndex, executeCommand, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (open) onClose();
        else {
          // Toggle is handled by parent
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "r" && !open) {
        e.preventDefault();
        if (!runBusy && pendingCount === 0) onRunPolicy();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "e" && !open) {
        e.preventDefault();
        onEditPolicy();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "l" && !open) {
        e.preventDefault();
        onViewLedger();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, onRunPolicy, onEditPolicy, onViewLedger, runBusy, pendingCount]);

  if (!open) return null;

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette__input-wrap">
          <Search size={16} />
          <input
            ref={inputRef}
            type="text"
            className="command-palette__input"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="command-palette__close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="command-palette__list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="command-palette__empty">No commands found</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                className={`command-palette__item ${i === selectedIndex ? "command-palette__item--selected" : ""} ${cmd.disabled ? "command-palette__item--disabled" : ""}`}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
                disabled={cmd.disabled}
              >
                <span className="command-palette__item-icon">{cmd.icon}</span>
                <span className="command-palette__item-text">
                  <span className="command-palette__item-label">{cmd.label}</span>
                  <span className="command-palette__item-desc">{cmd.description}</span>
                </span>
                {cmd.shortcut && <kbd className="command-palette__item-shortcut">{cmd.shortcut}</kbd>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
