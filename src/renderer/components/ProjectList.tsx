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

  const handleClick = useCallback(async (filename: string) => {
    const base = filename.replace(/\.html$/, '');
    const result = await window.electronAPI.readAnimation(base);
    if (result.success) onLoad(filename, result.content);
  }, [onLoad]);

  if (files.length === 0) return null;

  return (
    <div className="project-list">
      <div className="project-list-label">My Animations</div>
      {files.map(f => (
        <button key={f} className="project-item" onClick={() => { void handleClick(f); }}>
          🎨 {f.replace(/\.html$/, '')}
        </button>
      ))}
    </div>
  );
}
