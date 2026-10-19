'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ImagePlus, Plus, Send, X} from 'lucide-react';
import {Button} from '@/components/ui/button';

export interface ChatAttachment {
    url: string;
    mime: string;
    name?: string;
}

interface ChatComposerProps {
    onSend: (text: string, attachments: ChatAttachment[]) => Promise<void> | void;
    placeholder?: string;
    disabled?: boolean;
}

const MAX_EDGE = 2000;
const MAX_FILES = 6;
const MAX_TEXTAREA_PX = 200;
const PASSTHROUGH_BYTES = 400 * 1024;

// Normalise to JPEG unless the source is already a small JPEG/PNG.
// Keeps the server allowlist strict (pdf/png/jpg) while never silently dropping a paste.
async function prepare(file: File): Promise<{blob: Blob; name: string}> {
    const fallback = {blob: file, name: file.name || 'image'};
    const alreadyOk = (file.type === 'image/jpeg' || file.type === 'image/png') && file.size <= PASSTHROUGH_BYTES;
    if (alreadyOk) return fallback;
    try {
        const bitmap = await createImageBitmap(file);
        const longest = Math.max(bitmap.width, bitmap.height) || 1;
        const scale = Math.min(1, MAX_EDGE / longest);
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return fallback;
        ctx.drawImage(bitmap, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
        if (!blob) return fallback;
        const base = (file.name || 'image').replace(/\.[^.]+$/, '');
        return {blob: blob, name: base + '.jpg'};
    } catch {
        return fallback;
    }
}

export default function ChatComposer({onSend, placeholder, disabled}: ChatComposerProps) {
    const [text, setText] = useState('');
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [uploading, setUploading] = useState(0);
    const [menuOpen, setMenuOpen] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const taRef = useRef<HTMLTextAreaElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);

    const resize = useCallback(() => {
        const el = taRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_PX) + 'px';
    }, []);

    useEffect(() => {
        resize();
    }, [text, resize]);

    useEffect(() => {
        if (!menuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [menuOpen]);

    const upload = useCallback(async (file: File) => {
        setUploading((n) => n + 1);
        setError(null);
        try {
            const prepared = await prepare(file);
            const form = new FormData();
            form.append('file', new File([prepared.blob], prepared.name, {type: prepared.blob.type || 'image/jpeg'}));
            const res = await fetch('/api/static/uploads', {method: 'POST', body: form});
            if (!res.ok) throw new Error('upload failed');
            const data = await res.json();
            setAttachments((prev) => {
                const next = prev.concat([{url: data.url, mime: prepared.blob.type || 'image/jpeg', name: prepared.name}]);
                return next.slice(0, MAX_FILES);
            });
        } catch (err) {
            console.error('image upload failed', err);
            setError('Image upload failed - try again.');
        } finally {
            setUploading((n) => Math.max(0, n - 1));
        }
    }, []);

    const addFiles = useCallback((files: FileList | File[]) => {
        const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
        if (images.length === 0) {
            setError('Only image files are supported.');
            return;
        }
        images.forEach((f) => { void upload(f); });
    }, [upload]);

    const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) files.push(f);
            }
        }
        if (files.length === 0) return;
        // Only swallow the default when the clipboard carries no text,
        // so pasting text+image together keeps the text.
        const hasText = (e.clipboardData.getData('text/plain') || '').length > 0;
        if (!hasText) e.preventDefault();
        addFiles(files);
    }, [addFiles]);

    const send = useCallback(async () => {
        const trimmed = text.trim();
        if (sending || uploading > 0) return;
        if (!trimmed && attachments.length === 0) return;
        setSending(true);
        setError(null);
        try {
            await onSend(trimmed, attachments);
            setText('');
            setAttachments([]);
            requestAnimationFrame(() => {
                resize();
                taRef.current?.focus();
            });
        } finally {
            setSending(false);
        }
    }, [text, attachments, sending, uploading, onSend, resize]);

    const canSend = (text.trim().length > 0 || attachments.length > 0) && uploading === 0 && !sending && !disabled;

    return (
        <div className="flex w-full min-w-0 flex-col gap-2">
            {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {attachments.map((a, i) => (
                        <div key={a.url + i} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.url} alt={a.name || 'attachment'}
                                 className="h-16 w-16 rounded-md border border-gray-200 object-cover"/>
                            <button type="button"
                                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                                    className="absolute -right-1.5 -top-1.5 rounded-full bg-[#111827] p-0.5 text-white opacity-90"
                                    aria-label="Remove attachment">
                                <X className="h-3 w-3"/>
                            </button>
                        </div>
                    ))}
                    {uploading > 0 && (
                        <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-gray-300 text-[10px] text-gray-400">
                            ...
                        </div>
                    )}
                </div>
            )}

            {error && <div className="text-[11px] text-red-600">{error}</div>}

            <div className="flex w-full min-w-0 items-end gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 focus-within:ring-2 focus-within:ring-[#06b6d4]/30">
                <div className="relative" ref={menuRef}>
                    <button type="button" onClick={() => setMenuOpen((o) => !o)}
                            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                            aria-label="Add attachment">
                        <Plus className="h-4 w-4"/>
                    </button>
                    {menuOpen && (
                        <div className="absolute bottom-full left-0 z-20 mb-2 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                            <button type="button"
                                    onClick={() => {
                                        setMenuOpen(false);
                                        fileRef.current?.click();
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50">
                                <ImagePlus className="h-3.5 w-3.5"/> Image
                            </button>
                        </div>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" multiple hidden
                           onChange={(e) => {
                               if (e.target.files) addFiles(e.target.files);
                               e.target.value = '';
                           }}/>
                </div>

                <textarea
                    ref={taRef}
                    rows={1}
                    value={text}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={(e) => setText(e.target.value)}
                    onPaste={onPaste}
                    onCompositionStart={() => { composingRef.current = true; }}
                    onCompositionEnd={() => { composingRef.current = false; }}
                    onKeyDown={(e) => {
                        const native = e.nativeEvent as any;
                        if (e.key === 'Enter' && !e.shiftKey && !composingRef.current && !(native && native.isComposing)) {
                            e.preventDefault();
                            void send();
                        }
                    }}
                    className="max-h-[200px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm leading-6 outline-none"
                    style={{minHeight: '36px'}}
                />

                <Button onClick={() => { void send(); }} disabled={!canSend} className="shrink-0">
                    <Send className="h-4 w-4"/>
                </Button>
            </div>
        </div>
    );
}
