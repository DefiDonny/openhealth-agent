'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Send, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Activity, FileText, Pill, Upload, FolderOpen, MessageCircle, Trash2} from 'lucide-react';
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import Link from "next/link";

import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import ChatMessage from "@/components/chat/chat-message";
import useSWR from "swr";
import {useParams, useRouter} from "next/navigation";
import {ChatMessageListResponse} from "@/app/api/chat-rooms/[id]/messages/route";
import {ChatRole} from "@prisma/client";
import ChatSettingSideBar from "@/components/chat/chat-setting-side-bar";
import {useTranslations} from "next-intl";
import LogoutButton from "@/components/auth/logout-button";

interface SparklinePoint {
    value: number;
    date: string;
}

interface SparklineHover {
    x: number;
    y: number;
    value: number;
    date: string;
}

interface SparklineProps {
    data: SparklinePoint[];
    unit?: string;
    ticks?: number;
    gradientId: string;
    hovered: SparklineHover | null;
    onHover: (h: SparklineHover | null) => void;
    color?: string;
}

// Width reserved for the y-axis label column (labels are HTML so they never stretch).
const AXIS_W = 36;
// Chart height in px. Taller = more room for labels and a more legible trend.
const CHART_H = 64;

// Candidate "nice" steps: 1, 2, 2.5, 5, 10 across three decades around the rough step.
function niceCandidates(rough: number): number[] {
    const base = Math.pow(10, Math.floor(Math.log10(rough)));
    const out: number[] = [];
    const mults = [1, 2, 2.5, 5, 10];
    for (const m of mults) {
        out.push((m * base) / 10);
        out.push(m * base);
        out.push(m * base * 10);
    }
    return out.filter(s => isFinite(s) && s > 0);
}

// Round tick values that COVER the data (rounded outward), choosing the step whose
// label count lands closest to the requested target.
function computeTicks(min: number, max: number, target: number): number[] {
    if (!isFinite(min) || !isFinite(max) || max <= min) return [];
    const rough = (max - min) / Math.max(1, target - 1);
    let best: {step: number, start: number, count: number, score: number} | null = null;
    for (const step of niceCandidates(rough)) {
        const start = Math.floor(min / step) * step;
        const end = Math.ceil(max / step) * step;
        const count = Math.round((end - start) / step) + 1;
        if (count < 2 || count > 6) continue;
        const score = Math.abs(count - target);
        if (!best || score < best.score) best = {step: step, start: start, count: count, score: score};
    }
    if (!best) return [];
    const ticks: number[] = [];
    for (let i = 0; i < best.count; i++) {
        ticks.push(Number((best.start + i * best.step).toFixed(6)));
    }
    return ticks;
}

function formatTick(v: number, unit: string): string {
    const text = Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
    return unit ? text + unit : text;
}

function Sparkline({data, unit = '', ticks: tickTarget = 4, gradientId, hovered, onHover, color = '#06b6d4'}: SparklineProps) {
    const W = 200, H = 50;
    const padL = 2, padR = 3, padT = 3, padB = 3;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const hasData = data.length > 0;
    const values = data.map(p => p.value);
    const min = hasData ? Math.min(...values) : 0;
    const max = hasData ? Math.max(...values) : 1;

    const ticks = hasData ? computeTicks(min, max, tickTarget) : [];

    // Domain spans the labelled ticks, with a small margin so edge labels are not clipped.
    let yMin: number;
    let yMax: number;
    if (ticks.length >= 2) {
        const tSpan = ticks[ticks.length - 1] - ticks[0];
        const m = tSpan * 0.09;
        yMin = ticks[0] - m;
        yMax = ticks[ticks.length - 1] + m;
    } else {
        const span = (max - min) || 1;
        yMin = min - span * 0.14;
        yMax = max + span * 0.14;
    }
    const yRange = (yMax - yMin) || 1;

    const xFor = (i: number) => padL + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const yFor = (v: number) => padT + plotH - ((v - yMin) / yRange) * plotH;

    const vLines = [1, 2, 3, 4].map(k => padL + (plotW * k) / 5);
    const linePts = data.map((p, i) => xFor(i) + ',' + yFor(p.value)).join(' ');
    const floorY = H - padB;
    const gradId = gradientId + 'Grad';

    return (
        <div className="w-full flex items-center" style={{height: CHART_H + 'px'}}>
            <div className="relative shrink-0" style={{width: AXIS_W + 'px', height: CHART_H + 'px'}}>
                {ticks.map((t, i) => (
                    <span key={i}
                          className="absolute right-1.5 -translate-y-1/2 text-[10px] leading-none text-[#94a3b8] tabular-nums whitespace-nowrap"
                          style={{top: (yFor(t) / H) * 100 + '%'}}>
                        {formatTick(t, unit)}
                    </span>
                ))}
            </div>
            <div className="relative flex-1 min-w-0" style={{height: CHART_H + 'px'}}>
                <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" style={{height: CHART_H + 'px'}}
                     preserveAspectRatio="none" onMouseLeave={() => onHover(null)}>
                    <defs>
                        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.22"/>
                            <stop offset="100%" stopColor={color} stopOpacity="0"/>
                        </linearGradient>
                    </defs>

                    <line x1={padL} y1={padT} x2={padL} y2={H - padB}
                          stroke="#334155" strokeWidth="0.7" opacity="0.75" vectorEffect="non-scaling-stroke"/>

                    {ticks.map((t, i) => (
                        <line key={'h' + i} x1={padL} y1={yFor(t)} x2={W - padR} y2={yFor(t)}
                              stroke="#334155" strokeWidth="0.7" strokeDasharray="2,3" opacity="0.7"
                              vectorEffect="non-scaling-stroke"/>
                    ))}

                    {vLines.map((vx, i) => (
                        <line key={'v' + i} x1={vx} y1={padT} x2={vx} y2={H - padB}
                              stroke="#334155" strokeWidth="0.7" strokeDasharray="2,3" opacity="0.55"
                              vectorEffect="non-scaling-stroke"/>
                    ))}

                    {hasData && (
                        <>
                            <polygon points={xFor(0) + ',' + floorY + ' ' + linePts + ' ' + xFor(data.length - 1) + ',' + floorY}
                                     fill={'url(#' + gradId + ')'}/>
                            <polyline points={linePts} fill="none" stroke={color} strokeWidth="2"
                                      strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
                        </>
                    )}

                    {data.map((p, i) => (
                        <circle key={'hit' + i} cx={xFor(i)} cy={yFor(p.value)} r="6" fill="transparent"
                                style={{cursor: 'crosshair'}}
                                onMouseEnter={() => onHover({x: xFor(i), y: yFor(p.value), value: p.value, date: p.date})}/>
                    ))}

                    {hovered && (
                        <circle cx={hovered.x} cy={hovered.y} r="3" fill={color} stroke="#fff" strokeWidth="1"/>
                    )}
                </svg>
            </div>
        </div>
    );
}

interface ScreenProps {
    isMobile: boolean;
}

export default function Screen(
    {isMobile}: ScreenProps
) {
    const {id} = useParams<{ id: string }>();
    const router = useRouter();
    const t = useTranslations('Chat')

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const [inputText, setInputText] = useState('');
    const [sources] = useState([]);
    const [isJsonViewerOpen, setIsJsonViewerOpen] = useState(false);
    const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(!isMobile);
    const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(!isMobile);

    // New Chat dialog state
    const [isNewChatDialogOpen, setIsNewChatDialogOpen] = useState(false);
    const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
    const [initialMessage, setInitialMessage] = useState('');
    const [isCreatingChat, setIsCreatingChat] = useState(false);

    // Sleep sparkline hover state
    const [hoveredSleep, setHoveredSleep] = useState<SparklineHover | null>(null);

    // Medications dialog state
    const [isMedsOpen, setIsMedsOpen] = useState(false);
    const [medsText, setMedsText] = useState('');
    const [medsConfirm, setMedsConfirm] = useState(false);

    // Fetch chat rooms for left sidebar
    const {data: chatRoomsData, mutate: mutateChatRooms} = useSWR<{chatRooms: any[]}>('/api/chat-rooms', async (url: string) => {
        const response = await fetch(url);
        return response.json();
    });
    const chatRooms = chatRoomsData?.chatRooms || [];

    // Fetch health data (used for count + WHOOP sleep data + medications)
    const {data: healthDataListResponse, mutate: mutateHealthData} = useSWR<{healthDataList: Array<{id: string, type: string, data: any}>}>('/api/health-data', (url: string) => fetch(url).then(r => r.json()));
    const healthDataCount = (healthDataListResponse?.healthDataList?.filter((d: any) => d.type !== 'PERSONAL_INFO')?.length) || 0;

    // Extract WHOOP sleep data
    const whoopRecord = healthDataListResponse?.healthDataList?.find((d) => d.type === 'WHOOP_DATA');
    const sleepHistory: Array<{date: string, performance_pct: number, total_sleep_hrs: number}> =
        whoopRecord?.data?.sleep_history || [];
    const latestSleep = sleepHistory[0] || null;

    // Weight data: combine Xiaomi history + Withings
    const weightHistoryRecord = healthDataListResponse?.healthDataList?.find((d) => d.type === 'WEIGHT_HISTORY');
    const withingsRecord = healthDataListResponse?.healthDataList?.find((d) => d.type === 'WITHINGS_DATA');
    const allWeights: Array<{date: string, weight_kg: number}> = [
        ...(weightHistoryRecord?.data?.measurements || []).map((m: any) => ({date: m.date, weight_kg: m.weight_kg})),
        ...(withingsRecord?.data?.measurements || [])
            .filter((m: any) => m.weight_kg)
            .map((m: any) => ({date: m.date, weight_kg: m.weight_kg})),
    ].sort((a: any, b: any) => b.date.localeCompare(a.date));
    const latestWeight = allWeights[0] || null;
    const prevWeight = allWeights.length > 1 ? allWeights[1] : null;
    const weightDelta = latestWeight && prevWeight ? Math.round((latestWeight.weight_kg - prevWeight.weight_kg) * 100) / 100 : 0;

    // Derived sleep display values
    const sleepScoreDisplay = latestSleep ? `${Math.round(latestSleep.performance_pct)}` : '—';
    const sleepHrsDisplay = (() => {
        if (!latestSleep) return '—';
        const hrs = Math.floor(latestSleep.total_sleep_hrs);
        const mins = Math.round((latestSleep.total_sleep_hrs - hrs) * 60);
        const dateStr = latestSleep.date
            ? (() => {
                const d = new Date(latestSleep.date);
                return d.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
              })()
            : '';
        return `${hrs}h ${mins}m on ${dateStr}`;
    })();

    // Normalized data for shared Sparkline component
    const sleepData = useMemo(() =>
        [...sleepHistory].reverse().slice(0, 30).map(s => ({value: s.performance_pct, date: s.date})),
        [sleepHistory]
    );
    const weightData = useMemo(() =>
        [...allWeights].reverse().slice(-30).map(m => ({value: m.weight_kg, date: m.date})),
        [allWeights]
    );
    const [hoveredWeight, setHoveredWeight] = useState<SparklineHover | null>(null);

    // Fetch assistant modes for New Chat dialog
    const {data: assistantModesData} = useSWR<{assistantModes: any[]}>('/api/assistant-modes', async (url: string) => {
        const response = await fetch(url);
        return response.json();
    });
    const assistantModes = assistantModesData?.assistantModes || [];

    const {data, mutate} = useSWR<ChatMessageListResponse>(`/api/chat-rooms/${id}/messages`, async (url: string) => {
        const response = await fetch(url);
        return response.json();
    });
    const messages = useMemo(() => data?.chatMessages || [], [data]);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({behavior: 'smooth'});
        }
    }, [messages]);

    const handleSendMessage = async () => {
        if (!inputText.trim()) return;
        setInputText('');

        const oldMessages = [...messages, {
            id: new Date().toISOString(),
            content: inputText,
            role: 'USER' as ChatRole,
            createdAt: new Date(),
        }];
        await mutate({chatMessages: oldMessages}, {revalidate: false});

        const response = await fetch(`/api/chat-rooms/${id}/messages`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ content: inputText, role: 'USER' })
        });

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        const createdAt = new Date()
        if (reader) {
            let done = false;
            while (!done) {
                const {value, done: isDone} = await reader.read();
                done = isDone;
                const content = decoder.decode(value, {stream: !done});
                for (const data of content.split('\n').filter(Boolean)) {
                    const {content, error}: { content?: string, error?: string } = JSON.parse(data)
                    if (error) { console.error('Error from LLM:', error); continue; }
                    if (content) {
                        await mutate({
                            chatMessages: [
                                ...oldMessages,
                                {id: new Date().toISOString(), content: content, role: 'ASSISTANT', createdAt}
                            ]
                        }, {revalidate: false});
                    }
                }
            }
            await mutate();
        }
    };

    const handleStartNewChat = async () => {
        if (!selectedDoctorId || !initialMessage.trim()) return;
        setIsCreatingChat(true);
        try {
            // 1. Create new chat room
            const chatRoomResponse = await fetch('/api/chat-rooms', { method: 'POST' });
            const newChatRoom = await chatRoomResponse.json();
            const newRoomId = newChatRoom.chatRoom?.id || newChatRoom.id;

            // 2. Set the assistant mode on the new room
            await fetch(`/api/chat-rooms/${newRoomId}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ assistantModeId: selectedDoctorId })
            });

            // 3. Close dialog and reset state
            setIsNewChatDialogOpen(false);
            setSelectedDoctorId('');
            const msgToSend = initialMessage;
            setInitialMessage('');

            // 4. Navigate to the new chat
            router.push(`/chat/${newRoomId}`);

            // 5. Send the initial message after navigation
            setTimeout(async () => {
                await fetch(`/api/chat-rooms/${newRoomId}/messages`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ content: msgToSend, role: 'USER' })
                });
                mutateChatRooms();
            }, 600);

        } catch (err) {
            console.error('Failed to create new chat:', err);
        } finally {
            setIsCreatingChat(false);
        }
    };

    const handleDeleteChat = async (e: React.MouseEvent, roomId: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('Delete this consultation?')) return;
        await fetch(`/api/chat-rooms/${roomId}`, {method: 'DELETE'});
        mutateChatRooms();
        // If we just deleted the current room, navigate away
        if (roomId === id) {
            const remaining = chatRooms.filter(r => r.id !== roomId);
            if (remaining.length > 0) {
                router.push(`/chat/${remaining[0].id}`);
            } else {
                router.push('/');
            }
        }
    };

    const loadMeds = async () => {
        try {
            const res = await fetch('/api/health-data');
            const data = await res.json();
            const medsRecord = data.healthDataList?.find((d: any) => d.type === 'MEDICATIONS');
            if (medsRecord) {
                setMedsText(medsRecord.data?.medications || '');
            } else {
                setMedsText('');
            }
        } finally {
        }
        setIsMedsOpen(true);
    };

    const saveMeds = async () => {
        // Re-fetch to get the latest state before saving
        const res = await fetch('/api/health-data');
        const data = await res.json();
        const existing = data.healthDataList?.find((d: any) => d.type === 'MEDICATIONS');

        if (existing) {
            await fetch(`/api/health-data/${existing.id}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({data: {medications: medsText, fileName: 'Medications & Supplements'}})
            });
        } else {
            await fetch('/api/health-data', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({type: 'MEDICATIONS', data: {medications: medsText, fileName: 'Medications & Supplements'}})
            });
        }
        setMedsConfirm(false);
        setIsMedsOpen(false);
        mutateHealthData();
    };

    // Format date+time for chat entries: "04/02 11:13 AM"
    const formatChatDate = (dateVal: any) => {
        const d = new Date(dateVal);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${mm}/${dd} ${hours}:${minutes} ${ampm}`;
    };

    return (
        <div className="h-screen flex flex-col">
            {/* ===== HEADER ===== */}
            <div className="bg-[#111827] border-b border-[#1e293b] h-11 flex items-center px-4 shrink-0 relative">
                {/* Left: sidebar toggle */}
                <div className="flex items-center">
                    <button onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
                            className="text-[#64748b] hover:text-[#94a3b8] transition-colors p-1">
                        {isLeftSidebarOpen
                            ? <PanelLeftClose className="w-4 h-4"/>
                            : <PanelLeftOpen className="w-4 h-4"/>}
                    </button>
                </div>

                {/* Center: logo + title (absolutely centered) */}
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19.5 12.572l-7.5 7.428-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.572"/>
                        <path d="M12 6v4" opacity="0.7"/><path d="M10 10h4" opacity="0.7"/>
                    </svg>
                    <span className="text-[17px] font-bold text-white tracking-tight">
                        <span className="text-[#06b6d4]">OpenHealth Agent</span>
                    </span>
                </div>

                {/* Right: Log out text + logout button + right sidebar toggle */}
                <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => { window.location.href = '/api/auth/signout' }} className="text-[12px] text-[#94a3b8] hover:text-white transition-colors cursor-pointer">Log out</button>
                    <LogoutButton/>
                    <button onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
                            className="text-[#64748b] hover:text-[#94a3b8] transition-colors p-1">
                        {isRightSidebarOpen
                            ? <PanelRightClose className="w-4 h-4"/>
                            : <PanelRightOpen className="w-4 h-4"/>}
                    </button>
                </div>
            </div>

            {/* ===== DASHBOARD BAR (Weight trendline + Sleep + Quick Access) ===== */}
            <div className="bg-[#0a0e17] border-b border-[#1e293b] shrink-0">
                <div className="grid grid-cols-3 gap-3 px-4 py-2.5" style={{maxHeight: '140px'}}>
                    {/* Weight Card - Real Data */}
                    <div className="bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-2.5 flex items-center gap-3">
                        <div className="min-w-0">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">Weight</div>
                            <div className="text-[22px] font-bold text-white leading-none mt-0.5">
                                {latestWeight ? latestWeight.weight_kg.toFixed(1) : '--'} <span className="text-[12px] font-medium text-[#64748b]">kg</span>
                            </div>
                            <div className={`text-[10px] font-semibold mt-0.5 ${weightDelta <= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                                {weightDelta !== 0 ? `${weightDelta > 0 ? '\u25b2' : '\u25bc'} ${Math.abs(weightDelta).toFixed(1)} kg` : ''}
                                {latestWeight ? ` on ${new Date(latestWeight.date).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'})}` : ''}
                            </div>
                        </div>
                        <div className="flex-1 h-full min-w-0 flex items-center relative">
                            <Sparkline
                                data={weightData}
                                unit=""
                                ticks={5}
                                gradientId="weightFill"
                                hovered={hoveredWeight}
                                onHover={setHoveredWeight}
                            />
                            {hoveredWeight && (
                                <div className="absolute bg-[#1e293b] text-[10px] text-white px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap z-10"
                                    style={{left: 'calc(' + AXIS_W + 'px + (100% - ' + AXIS_W + 'px) * ' + Math.min(0.98, Math.max(0.02, hoveredWeight.x / 200)).toFixed(4) + ')', top: '-4px'}}>
                                    {hoveredWeight.value.toFixed(1)}kg &middot; {hoveredWeight.date}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Sleep Score Card */}
                    <div className="bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-2.5 flex items-center gap-3">
                        <div className="min-w-0">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">Sleep Score</div>
                            <div className="text-[22px] font-bold text-white leading-none mt-0.5">
                                {sleepScoreDisplay}<span className="text-[14px] font-medium">%</span>
                            </div>
                            <div className="text-[10px] font-semibold text-[#22c55e] mt-0.5">{sleepHrsDisplay}</div>
                        </div>
                        <div className="flex-1 h-full min-w-0 flex items-center relative">
                            <Sparkline
                                data={sleepData}
                                unit=" %"
                                ticks={4}
                                gradientId="sleepFill"
                                hovered={hoveredSleep}
                                onHover={setHoveredSleep}
                            />
                            {hoveredSleep && (
                                <div
                                    className="absolute z-50 pointer-events-none bg-[#0a0e17] border border-[#1e293b] rounded px-2 py-1 text-[10px] text-white whitespace-nowrap shadow-lg"
                                    style={{
                                        left: 'calc(' + AXIS_W + 'px + (100% - ' + AXIS_W + 'px) * ' + Math.min(0.98, Math.max(0.02, hoveredSleep.x / 200)).toFixed(4) + ')',
                                        bottom: '100%',
                                        transform: 'translateX(-50%)',
                                        marginBottom: '4px',
                                    }}
                                >
                                    <div className="font-semibold text-[#06b6d4]">{Math.round(hoveredSleep.value)}%</div>
                                    <div className="text-[#64748b]">{hoveredSleep.date}</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Quick Access Card */}
                    <div className="bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-2 flex flex-col gap-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">Quick Access</div>
                        <div className="grid grid-cols-2 gap-1 flex-1">
                            <button onClick={() => router.push('/source')}
                                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#1e293b] text-[11px] text-[#e8edf5] hover:border-[#06b6d4] hover:text-[#06b6d4] transition-colors">
                                <Activity className="w-3 h-3 text-[#06b6d4] shrink-0"/>Vitals
                            </button>
                            <button onClick={() => router.push('/source')}
                                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#1e293b] text-[11px] text-[#e8edf5] hover:border-[#06b6d4] hover:text-[#06b6d4] transition-colors">
                                <FileText className="w-3 h-3 text-[#06b6d4] shrink-0"/>Labs
                            </button>
                            <button onClick={loadMeds}
                                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#1e293b] text-[11px] text-[#e8edf5] hover:border-[#06b6d4] hover:text-[#06b6d4] transition-colors">
                                <Pill className="w-3 h-3 text-[#06b6d4] shrink-0"/>Meds
                            </button>
                            <button onClick={() => router.push('/source')}
                                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#1e293b] text-[11px] text-[#e8edf5] hover:border-[#06b6d4] hover:text-[#06b6d4] transition-colors">
                                <Upload className="w-3 h-3 text-[#06b6d4] shrink-0"/>Upload
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ===== MAIN CONTENT ===== */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left sidebar — collapsible, w-56 */}
                {isLeftSidebarOpen && (
                    <div className="w-56 border-r bg-gray-50 flex flex-col overflow-hidden shrink-0">
                        {/* SOURCES section */}
                        <div className="px-3 pt-3 pb-1">
                            <h3 className="text-[12px] font-bold text-gray-600 uppercase tracking-[0.12em]">Sources</h3>
                            {healthDataCount > 0 && (
                                <div className="text-[11px] text-gray-400 mt-0.5">{healthDataCount} file{healthDataCount !== 1 ? 's' : ''}</div>
                            )}
                        </div>
                        <div className="px-3 mb-3">
                            <button
                                onClick={() => router.push('/source')}
                                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white border border-gray-200 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
                            >
                                <FolderOpen className="w-3.5 h-3.5 shrink-0"/>
                                Manage Sources
                            </button>
                        </div>

                        {/* Thicker divider between sections */}
                        <div className="border-t-2 border-gray-300 mx-3 my-2"/>

                        {/* CONSULTATIONS section */}
                        <div className="px-3 pt-1 pb-1">
                            <h3 className="text-[12px] font-bold text-gray-600 uppercase tracking-[0.12em]">Consultations</h3>
                        </div>
                        <div className="px-3 mb-2">
                            <button
                                onClick={() => setIsNewChatDialogOpen(true)}
                                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-blue-600 text-white rounded-lg text-[12px] font-medium hover:bg-blue-700 transition-colors shadow-sm"
                            >
                                <MessageCircle className="w-3.5 h-3.5 shrink-0"/>
                                New Consultation
                            </button>
                        </div>

                        {/* Chat history list */}
                        <div className="flex-1 overflow-y-auto px-2 pb-2">
                            {chatRooms.map((room: any) => (
                                <Link
                                    key={room.id}
                                    href={`/chat/${room.id}`}
                                    className={`flex flex-col p-2 rounded-lg mb-1 text-[12px] truncate transition-colors ${
                                        room.id === id
                                            ? 'bg-white border border-gray-200 shadow-sm font-medium text-gray-900'
                                            : 'hover:bg-gray-100 text-gray-600'
                                    }`}
                                >
                                    <div className="truncate">{room.name || 'New Chat'}</div>
                                    {room.lastActivityAt && (
                                        <div className="flex items-center justify-between mt-0.5">
                                            <span className="text-[10px] text-gray-400">
                                                {formatChatDate(room.lastActivityAt)}
                                            </span>
                                            <button
                                                onClick={(e) => handleDeleteChat(e, room.id)}
                                                className="text-gray-300 hover:text-red-500 transition-colors ml-1 shrink-0"
                                                title="Delete consultation"
                                            >
                                                <Trash2 className="w-3 h-3"/>
                                            </button>
                                        </div>
                                    )}
                                </Link>
                            ))}
                        </div>
                    </div>
                )}

                {/* Main chat area */}
                <div className="flex-1 flex flex-col bg-white min-w-0">
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {messages.map((message, index) => (
                            <ChatMessage key={index} message={message}/>
                        ))}
                        <div ref={messagesEndRef}/>
                    </div>
                    <div className="mb-16 md:mb-0">
                        <div className="border-t p-4 z-10 md:static fixed bottom-0 left-0 w-full bg-white">
                            <div className="flex gap-2">
                                <Input
                                    placeholder={t('inputPlaceholder')}
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        }
                                    }}
                                />
                                <Button onClick={handleSendMessage}>
                                    <Send className="w-4 h-4"/>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right sidebar — collapsible */}
                {isRightSidebarOpen && !isMobile && (
                    <div className="w-56 border-l bg-gray-50 flex flex-col overflow-y-auto shrink-0">
                        <ChatSettingSideBar chatRoomId={id}/>
                    </div>
                )}
            </div>

            {/* ===== JSON Viewer Dialog (legacy) ===== */}
            <Dialog open={isJsonViewerOpen} onOpenChange={setIsJsonViewerOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh]">
                    <DialogHeader><DialogTitle>Source Data</DialogTitle></DialogHeader>
                    <div className="overflow-y-auto">
                        <pre className="text-xs bg-gray-50 p-4 rounded overflow-auto">
                            {JSON.stringify(sources, null, 2)}
                        </pre>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ===== NEW CHAT DIALOG ===== */}
            <Dialog open={isNewChatDialogOpen} onOpenChange={(open) => {
                setIsNewChatDialogOpen(open);
                if (!open) {
                    setSelectedDoctorId('');
                    setInitialMessage('');
                }
            }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Start a New Consultation</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {/* Doctor selection grid */}
                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-2 block">
                                Choose your Doctor
                            </label>
                            {assistantModes.length === 0 ? (
                                <div className="text-sm text-gray-400 py-3 text-center">Loading doctors...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    {assistantModes.map((mode: any) => (
                                        <button
                                            key={mode.id}
                                            onClick={() => setSelectedDoctorId(mode.id)}
                                            className={`p-3 rounded-lg border text-left transition-colors ${
                                                selectedDoctorId === mode.id
                                                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                                                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                            }`}
                                        >
                                            <div className="text-sm font-medium text-gray-900 leading-tight">{mode.name}</div>
                                            {mode.description && (
                                                <div className="text-xs text-gray-500 mt-0.5 leading-tight line-clamp-2">{mode.description}</div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Initial message input */}
                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-2 block">
                                What would you like to discuss?
                            </label>
                            <textarea
                                placeholder="Describe your health concern or question..."
                                value={initialMessage}
                                onChange={(e) => setInitialMessage(e.target.value)}
                                className="w-full p-3 border border-gray-200 rounded-lg text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>

                        {/* Start Consultation CTA */}
                        <button
                            onClick={handleStartNewChat}
                            disabled={!selectedDoctorId || !initialMessage.trim() || isCreatingChat}
                            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {isCreatingChat ? 'Starting...' : 'Start Consultation'}
                        </button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ===== MEDICATIONS DIALOG ===== */}
            <Dialog open={isMedsOpen} onOpenChange={(open) => {
                if (!open) { setIsMedsOpen(false); setMedsConfirm(false); }
            }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-gray-700">
                            Medicines and Supplements
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <textarea
                            value={medsText}
                            onChange={(e) => setMedsText(e.target.value)}
                            rows={6}
                            className="w-full p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent overflow-y-auto"
                            placeholder="Enter your medications and supplements here..."
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setMedsConfirm(true)}
                                className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
                            >
                                Save
                            </button>
                            <button
                                onClick={() => { setIsMedsOpen(false); setMedsConfirm(false); }}
                                className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-200 transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ===== MEDICATIONS CONFIRM DIALOG ===== */}
            <Dialog open={medsConfirm} onOpenChange={setMedsConfirm}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Save Changes?</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-gray-600 py-2">Save changes to your medications?</p>
                    <div className="flex gap-2">
                        <button
                            onClick={saveMeds}
                            className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
                        >
                            Yes
                        </button>
                        <button
                            onClick={() => setMedsConfirm(false)}
                            className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-200 transition-colors"
                        >
                            No
                        </button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
