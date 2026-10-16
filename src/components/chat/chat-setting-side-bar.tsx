'use client';

import React, {useEffect, useMemo, useState} from "react";
import useSWR from "swr";
import {AssistantMode, AssistantModeListResponse} from "@/app/api/assistant-modes/route";
import {ChatRoomGetResponse} from "@/app/api/chat-rooms/[id]/route";
import {LLMProvider, LLMProviderListResponse} from "@/app/api/llm-providers/route";
import {LLMProviderModel, LLMProviderModelListResponse} from "@/app/api/llm-providers/[id]/models/route";
import {AssistantModePatchRequest} from "@/app/api/assistant-modes/[id]/route";
import {Info} from 'lucide-react';
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/components/ui/dialog";
// cn removed — not used in simplified sidebar
// useTranslations removed — using hardcoded strings for customized UI

interface ChatSettingSideBarProps {
    chatRoomId: string;
}

export default function ChatSettingSideBar({chatRoomId}: ChatSettingSideBarProps) {

    const [selectedAssistantMode, setSelectedAssistantMode] = useState<AssistantMode>();
    const [selectedLLMProvider, setSelectedLLMProvider] = useState<LLMProvider>();
    const [selectedLLMProviderModel, setSelectedLLMProviderModel] = useState<LLMProviderModel>();
    const [llmProviderModels, setLLMProviderModels] = useState<LLMProviderModel[]>([]);
    const [infoMode, setInfoMode] = useState<{name: string, prompt: string} | null>(null);

    const {
        data: chatRoomData,
        mutate: chatRoomMutate
    } = useSWR<ChatRoomGetResponse>(`/api/chat-rooms/${chatRoomId}`, async (url: string) => {
        const response = await fetch(url);
        return response.json();
    });

    const {
        data: llmProvidersData,
    } = useSWR<LLMProviderListResponse>('/api/llm-providers', async (url: string) => {
        const response = await fetch(url);
        return response.json();
    })

    useEffect(() => {
        onChangeChatRoom({
            llmProviderModelId: selectedLLMProviderModel?.id
        })
    }, [selectedLLMProviderModel]);

    useEffect(() => {
        if (!chatRoomData?.chatRoom.assistantMode) return;
        setSelectedAssistantMode(chatRoomData.chatRoom.assistantMode);
    }, [chatRoomData?.chatRoom.assistantMode?.id]);

    useEffect(() => {
        const chatRoom = chatRoomData?.chatRoom;
        if (!chatRoom) return;

        const llmProviders = llmProvidersData?.llmProviders || [];
        const models = llmProviderModels || [];

        if (selectedLLMProvider === undefined && llmProviders.length > 0) {
            setSelectedLLMProvider(llmProviders.find((provider) => provider.id === chatRoom.llmProviderId) || llmProviders[0]);
        }

        if (selectedLLMProviderModel === undefined && models.length > 0) {
            setSelectedLLMProviderModel(models.find((model) => model.id === chatRoom.llmProviderModelId) || models[0]);
        }
    }, [chatRoomData, llmProvidersData, llmProviderModels]);

    const {
        data: assistantModesData,
        mutate: assistantModesMutate
    } = useSWR<AssistantModeListResponse>('/api/assistant-modes', async (url: string) => {
        const response = await fetch(url);
        return response.json();
    })
    const assistantModes = useMemo(() => assistantModesData?.assistantModes || [], [assistantModesData]);

    // Fetch models when LLM is selected (still needed for internal state)
    useEffect(() => {
        if (!selectedLLMProvider) return;
        const fetchLLMProviderModels = async () => {
            const response = await fetch(`/api/llm-providers/${selectedLLMProvider.id}/models`)
            const data: LLMProviderModelListResponse = await response.json();
            setLLMProviderModels(data.llmProviderModels || []);
        }
        fetchLLMProviderModels();
    }, [selectedLLMProvider]);

    const onChangeChatRoom = async ({
                                        assistantModeId,
                                        llmProviderId,
                                        llmProviderModelId,
                                    }: {
        assistantModeId?: string
        llmProviderId?: string
        llmProviderModelId?: string | null
    }) => {
        if (chatRoomData === undefined) return;
        const response = await fetch(`/api/chat-rooms/${chatRoomId}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({assistantModeId, llmProviderId, llmProviderModelId}),
        });
        const data = await response.json();

        const updatedAssistantMode = {
            ...data.chatRoom.assistantMode,
            systemPrompt: data.chatRoom.assistantMode.systemPrompt
        };

        await chatRoomMutate({
            ...chatRoomData,
            chatRoom: {
                ...chatRoomData.chatRoom,
                assistantMode: updatedAssistantMode,
                llmProviderId: llmProviderId || chatRoomData.chatRoom.llmProviderId,
                llmProviderModelId: llmProviderModelId || chatRoomData.chatRoom.llmProviderModelId,
            }
        });
        setSelectedAssistantMode(updatedAssistantMode);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const onChangeAssistantMode = async (assistantModeId: string, body: AssistantModePatchRequest) => {
        const response = await fetch(`/api/assistant-modes/${assistantModeId}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body),
        })
        const data = await response.json();

        await assistantModesMutate({
            ...assistantModesData,
            assistantModes: assistantModesData?.assistantModes.map((assistantMode) => {
                if (assistantMode.id === assistantModeId) {
                    return data.assistantMode;
                }
                return assistantMode;
            }) || []
        })
    }

    return <div className="h-full overflow-y-auto">
        <div className="p-3 space-y-2">
            {/* Assistant Mode only — no Model Settings, no System Prompt, no API Key */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Available Doctors</h4>
                </div>
                <div className="space-y-1.5">
                    {assistantModes.map((assistantMode) => (
                        <button
                            key={assistantMode.id}
                            className={`relative w-full p-2.5 rounded-lg text-left border transition-colors
                        ${selectedAssistantMode?.id === assistantMode.id ? 'bg-white border-gray-300 shadow-sm' :
                                'border-transparent hover:bg-gray-100'}`}
                            onClick={async () => {
                                await onChangeChatRoom({assistantModeId: assistantMode.id});
                            }}
                        >
                            <div className="text-[13px] font-medium leading-tight pr-5">{assistantMode.name}</div>
                            <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">{assistantMode.description}</div>
                            <button
                                className="absolute top-1.5 right-1.5 p-0.5 text-gray-400 hover:text-blue-500 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setInfoMode({name: assistantMode.name, prompt: assistantMode.systemPrompt});
                                }}
                            >
                                <Info className="w-3.5 h-3.5"/>
                            </button>
                        </button>
                    ))}
                </div>
            </div>
        </div>

        {/* Info Dialog — shows full system prompt for a doctor */}
        <Dialog open={!!infoMode} onOpenChange={() => setInfoMode(null)}>
            <DialogContent className="max-w-lg max-h-[70vh]">
                <DialogHeader>
                    <DialogTitle>{infoMode?.name}</DialogTitle>
                </DialogHeader>
                <div className="overflow-y-auto max-h-[50vh] text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
                    {infoMode?.prompt}
                </div>
                <div className="flex justify-end pt-2">
                    <button onClick={() => setInfoMode(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
                        Close
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    </div>
}
