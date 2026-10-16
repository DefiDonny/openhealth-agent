'use client';

import React, {useEffect, useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {AuroraBackground} from '@/components/ui/aurora-background';
import {motion} from 'framer-motion';
import {signIn} from "next-auth/react";
import {useTranslations} from "next-intl";

export default function LoginScreen() {
    const t = useTranslations('LoginPage')
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const searchParams = useSearchParams();

    useEffect(() => {
        if (searchParams.get('error')) {
            setError('Invalid username or password');
        }
    }, [searchParams]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        async function handle() {
            const username = 'admin';
            const params = {username, password, redirectTo: '/'}
            await signIn('credentials', params);
        }
        handle().then();
    };

    return (
        <AuroraBackground>
            <div className="flex flex-col items-center justify-center w-full max-w-4xl mx-auto px-4">
                <motion.div initial={{opacity: 0.0, y: 20}} animate={{opacity: 1, y: 0}} transition={{delay: 0.1, duration: 0.8, ease: "easeInOut"}} className="text-center mb-12">
                    <h1 className="text-5xl font-bold text-white tracking-tight">OpenHealth Agent</h1>
                    <p className="text-sm text-zinc-400 mt-2">powered by OpenHealth</p>
                </motion.div>
                <motion.div initial={{opacity: 0.0, y: 40}} animate={{opacity: 1, y: 0}} transition={{delay: 0.3, duration: 0.8, ease: "easeInOut"}} className="w-full max-w-sm space-y-6 p-8 bg-zinc-900/40 backdrop-blur-md rounded-xl shadow-2xl">
                    {error && (<div className="text-red-500 text-sm text-center">{error}</div>)}
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <div className="rounded-md shadow-sm space-y-4">
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-zinc-300">{t('password')}</label>
                                <input id="password" name="password" type="password" required className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-zinc-700/50 bg-zinc-800/30 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-zinc-500" placeholder={t('passwordPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)}/>
                            </div>
                        </div>
                        <div>
                            <button type="submit" className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-lg text-zinc-900 bg-white hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-500 transition-colors duration-200">{t('signIn')}</button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AuroraBackground>
    );
}
