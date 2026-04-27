import React, { useState, useEffect, useCallback } from 'react';

interface Props {
  onLoad: (filename: string, content: string) => void;
  refreshTrigger?: number | string | null;
}

export function ProjectList({ onLoad, refreshTrigger }: Props) {
  const [files, setFiles] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const result = await window.electronAPI.listAnimations();
    if (result.success) setFiles(result.files);
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshTrigger]);

  const handleLoad = useCallback(async (filename: string) => {
    const base = filename.replace(/\.html$/, '');
    const result = await window.electronAPI.readAnimation(base);
    if (result.success) onLoad(filename, result.content);
  }, [onLoad]);

  const handleDelete = useCallback(async (e: React.MouseEvent, filename: string) => {
    e.stopPropagation();
    const name = filename.replace(/\.html$/, '');
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const result = await window.electronAPI.deleteAnimation(filename);
    if (result.success) await refresh();
  }, [refresh]);

  if (files.length === 0) return null;

  return (
    <div className="project-list">
      <div className="project-list-label">My Animations</div>
      {files.map(f => (
        <div key={f} className="project-item-row">
          <button className="project-item" onClick={() => { void handleLoad(f); }}>
            🎨 {f.replace(/\.html$/, '')}
          </button>
          <button className="project-delete" title="Delete" onClick={(e) => { void handleDelete(e, f); }}>
            🗑️
          </button>
        </div>
      ))}
    </div>
  );
}
