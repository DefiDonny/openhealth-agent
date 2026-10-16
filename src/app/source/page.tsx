'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { X, ArrowLeft } from 'lucide-react';
import SourceAddScreen from '@/components/source/source-add-screen';

export default function SourcePage() {
    const router = useRouter();
    return (
        <div className="flex flex-col h-screen">
            {/* ===== HEADER ===== */}
            <div className="bg-[#111827] border-b border-[#1e293b] h-11 flex items-center px-4 shrink-0">
                <div className="flex items-center gap-2">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19.5 12.572l-7.5 7.428-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.572"/>
                        <path d="M12 6v4" opacity="0.7"/><path d="M10 10h4" opacity="0.7"/>
                    </svg>
                    <span className="text-[16px] font-bold text-white tracking-tight">
                        OpenHealth Agent
                    </span>
                </div>
                <div className="flex-1"/>
                {/* No close/back button in the title bar — moved below */}
            </div>

            {/* ===== SOURCE MANAGEMENT BAR ===== */}
            <div className="bg-white border-b border-gray-200 h-10 flex items-center px-4 shrink-0">
                {/* Back arrow on the left */}
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-1.5 text-gray-500 hover:text-gray-800 transition-colors mr-3"
                    aria-label="Go back"
                >
                    <ArrowLeft className="h-4 w-4"/>
                </button>
                <span className="text-[13px] font-semibold text-gray-700">Source Management</span>
                <div className="flex-1"/>
                {/* X close button on the right */}
                <button
                    onClick={() => router.back()}
                    className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                    aria-label="Close"
                >
                    <X className="h-4 w-4"/>
                </button>
            </div>

            {/* ===== CONTENT ===== */}
            <div className="flex-1 overflow-auto">
                <SourceAddScreen />
            </div>
        </div>
    );
}
