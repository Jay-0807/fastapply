// Popup — the small panel that opens when you click the toolbar icon.
// Job: quick project switch + open the side panel for actual form filling.

import { useEffect, useState } from 'react';
import { Sparkles, Settings, FolderOpen, History, Flame } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import type { Project } from '@/lib/db/types';

export function PopupApp() {
  // In-memory sort by updatedAt (falling back to createdAt) — avoids relying
  // on a Dexie index that may not exist if the user's local DB is still on the
  // pre-v2 schema and the migration hasn't run yet.
  const projects = useLiveQuery(async () => {
    const all = await db.projects.toArray();
    return all.sort((a, b) => {
      const ta = a.updatedAt ?? a.createdAt;
      const tb = b.updatedAt ?? b.createdAt;
      return tb - ta;
    });
  }, []) ?? [];
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [hasFormOnPage, setHasFormOnPage] = useState(false);

  useEffect(() => {
    // Quick check: does the active tab have any input/textarea?
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.querySelectorAll('input, textarea, select').length,
      }).then((res) => {
        setHasFormOnPage((res[0]?.result as number ?? 0) > 0);
      }).catch(() => setHasFormOnPage(false));
    });
  }, []);

  useEffect(() => {
    if (projects.length && !activeProjectId) setActiveProjectId(projects[0]!.id);
  }, [projects, activeProjectId]);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const openSidePanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    }
  };

  const openOptions = () => chrome.runtime.openOptionsPage();

  return (
    <div className="w-[380px] min-h-[440px] flex flex-col p-4 gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold flex items-center gap-1.5">
          <Flame className="w-4 h-4 text-orange-500" />
          <span>ApplyForge</span>
        </h1>
        <button onClick={openOptions} className="p-1 rounded hover:bg-muted" aria-label="设置">
          <Settings className="w-4 h-4" />
        </button>
      </header>

      <section className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">当前项目</label>
        {projects.length ? (
          <select
            value={activeProjectId ?? ''}
            onChange={(e) => setActiveProjectId(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                📁 {p.name} · {p.applicationCount} 次报名
              </option>
            ))}
          </select>
        ) : (
          <EmptyState onAction={openOptions} />
        )}
        {activeProject && (
          <p className="text-xs text-muted-foreground line-clamp-2">{activeProject.description}</p>
        )}
      </section>

      {activeProject && (
        <section
          className={`rounded-lg p-3 border ${hasFormOnPage ? 'border-primary bg-primary/5' : 'border-border bg-muted/40'}`}
        >
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="w-4 h-4 text-primary" />
            <span>{hasFormOnPage ? '当前页面似乎是表单' : '当前页面未检测到表单'}</span>
          </div>
          <button
            onClick={openSidePanel}
            disabled={!hasFormOnPage}
            className="mt-3 w-full py-2 px-3 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-40"
          >
            🚀 打开主面板填表
          </button>
        </section>
      )}

      <div className="border-t border-border" />

      <nav className="flex flex-col gap-1 text-sm">
        <button onClick={openOptions} className="flex items-center gap-2 py-2 px-1 hover:bg-muted rounded">
          <FolderOpen className="w-4 h-4" /> 我的项目档案
        </button>
        <button onClick={openOptions} className="flex items-center gap-2 py-2 px-1 hover:bg-muted rounded">
          <History className="w-4 h-4" /> 浏览历史经验库
        </button>
      </nav>
    </div>
  );
}

function EmptyState({ onAction }: { onAction: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-border p-4 text-center text-sm">
      <p className="mb-2">尚未创建项目</p>
      <button onClick={onAction} className="text-primary underline">
        去设置里创建第一个项目 →
      </button>
    </div>
  );
}
