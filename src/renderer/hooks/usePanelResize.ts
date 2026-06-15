import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface PanelResize {
  sidebarWidth: number;
  chatWidth: number;
  onSidebarDividerMouseDown: (event: React.MouseEvent) => void;
  onChatDividerMouseDown: (event: React.MouseEvent) => void;
}

/**
 * Draggable sidebar/chat column widths with localStorage persistence.
 * Extracted verbatim from App.tsx — identical default widths, clamp bounds,
 * persistence keys, and global mousemove/mouseup drag handling.
 */
export function usePanelResize(): PanelResize {
  const [sidebarWidth, setSidebarWidth] = useState(() => { const stored = localStorage.getItem('g4k-sidebar-width'); const value = stored ? parseInt(stored, 10) : 196; return Number.isNaN(value) || value < 80 || value > 400 ? 196 : value; });
  const [chatWidth, setChatWidth] = useState(() => { const stored = localStorage.getItem('g4k-chat-width'); const value = stored ? parseInt(stored, 10) : 390; return Number.isNaN(value) || value < 200 || value > 700 ? 390 : value; });

  const draggingTarget = useRef<'sidebar' | 'chat' | null>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => { localStorage.setItem('g4k-sidebar-width', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('g4k-chat-width', String(chatWidth)); }, [chatWidth]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!draggingTarget.current) return;
      if (draggingTarget.current === 'sidebar') {
        const delta = event.clientX - dragStartX.current;
        setSidebarWidth(Math.max(80, Math.min(500, dragStartWidth.current + delta)));
        return;
      }
      const delta = dragStartX.current - event.clientX;
      const maxChat = window.innerWidth - 350;
      setChatWidth(Math.max(0, Math.min(maxChat, dragStartWidth.current + delta)));
    };
    const onMouseUp = () => { draggingTarget.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const onSidebarDividerMouseDown = useCallback((event: React.MouseEvent) => {
    draggingTarget.current = 'sidebar';
    dragStartX.current = event.clientX;
    dragStartWidth.current = sidebarWidth;
    event.preventDefault();
  }, [sidebarWidth]);
  const onChatDividerMouseDown = useCallback((event: React.MouseEvent) => {
    draggingTarget.current = 'chat';
    dragStartX.current = event.clientX;
    dragStartWidth.current = chatWidth;
    event.preventDefault();
  }, [chatWidth]);

  return { sidebarWidth, chatWidth, onSidebarDividerMouseDown, onChatDividerMouseDown };
}
