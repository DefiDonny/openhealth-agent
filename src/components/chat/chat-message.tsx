/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import type {ChatMessage as ChatMessageType} from "@/app/api/chat-rooms/[id]/messages/route";
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import {cn} from "@/lib/utils";

interface ChatMessageProps {
    message: ChatMessageType
}

function ChatMessage({message}: ChatMessageProps) {
    const attachments: any[] = Array.isArray((message as any).attachments) ? (message as any).attachments : [];
    const isUser = message.role === 'USER';
    return <div className={cn('flex gap-2 p-2 rounded', !isUser && 'bg-gray-50')}>
        {!isUser && (
            <div className="shrink-0 mt-1">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="rounded-full bg-[#111827] p-1">
                    <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/>
                    <path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4"/>
                    <circle cx="20" cy="10" r="2"/>
                </svg>
            </div>
        )}
        <div className={cn('flex-1', isUser && 'text-right')}>
            {attachments.length > 0 && (
                <div className={cn('flex flex-wrap gap-2 mb-1', isUser && 'justify-end')}>
                    {attachments.map((a: any, i: number) => (
                        <a key={String(a && a.url ? a.url : 'att') + i}
                           href={a && a.url ? a.url : '#'} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a && a.url ? a.url : ''} alt={a && a.name ? a.name : 'attachment'}
                                 className="max-h-40 max-w-[240px] rounded-md border border-gray-200 object-cover"/>
                        </a>
                    ))}
                </div>
            )}
            <Markdown className={cn('text-sm', isUser ? undefined : 'prose')} remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{message.content}</Markdown>
        </div>
    </div>
}

export default React.memo(ChatMessage);
