import { Command } from "cmdk";
import { BookOpen, Boxes, Moon, Plus, Send, Settings, Sun } from "lucide-react";
import { useEffect } from "react";
import type { Workspace } from "../api";

export function CommandPalette({
  open,
  theme,
  workspaces,
  onClose,
  onNewRequest,
  onSelectWorkspace,
  onCreateWorkspace,
  onOpenSettings,
  onOpenKnowledge,
  onToggleTheme
}: {
  open: boolean;
  theme: "light" | "dark";
  workspaces: Workspace[];
  onClose: () => void;
  onNewRequest: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
  onOpenSettings: () => void;
  onOpenKnowledge: () => void;
  onToggleTheme: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <div className="rh-cmd-backdrop" role="presentation" onClick={onClose}>
      <div className="rh-cmd-panel" role="dialog" aria-label="命令面板" onClick={(event) => event.stopPropagation()}>
        <Command label="命令面板" className="rh-cmd">
          <Command.Input autoFocus className="rh-cmd-input" placeholder="搜索命令、Workspace…" />
          <Command.List className="rh-cmd-list">
            <Command.Empty className="rh-cmd-empty">没有匹配项</Command.Empty>
            <Command.Group heading="操作" className="rh-cmd-group">
              <Command.Item value="新建 request new quest" className="rh-cmd-item" onSelect={run(onNewRequest)}>
                <Send size={15} />
                <span>新建 Request</span>
              </Command.Item>
              <Command.Item value="创建 workspace create" className="rh-cmd-item" onSelect={run(onCreateWorkspace)}>
                <Plus size={15} />
                <span>创建 Workspace</span>
              </Command.Item>
              <Command.Item value="设置 settings repositories 仓库" className="rh-cmd-item" onSelect={run(onOpenSettings)}>
                <Settings size={15} />
                <span>打开设置</span>
              </Command.Item>
              <Command.Item value="知识中心 knowledge" className="rh-cmd-item" onSelect={run(onOpenKnowledge)}>
                <BookOpen size={15} />
                <span>打开知识中心</span>
              </Command.Item>
              <Command.Item value="主题 theme dark light 深色 浅色" className="rh-cmd-item" onSelect={run(onToggleTheme)}>
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                <span>{theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}</span>
              </Command.Item>
            </Command.Group>
            {workspaces.length > 0 ? (
              <Command.Group heading="切换 Workspace" className="rh-cmd-group">
                {workspaces.map((workspace) => (
                  <Command.Item
                    key={workspace.id}
                    value={`workspace ${workspace.name}`}
                    className="rh-cmd-item"
                    onSelect={run(() => onSelectWorkspace(workspace.id))}
                  >
                    <Boxes size={15} />
                    <span>{workspace.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
