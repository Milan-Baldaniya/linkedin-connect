'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Area, PieChart, Pie, Cell,
    RadialBarChart, RadialBar
} from 'recharts'

/* ────────────────────────── Types ────────────────────────── */

interface Post {
    id: string
    post_urn: string
    post_url: string
    posted_at: string
}

interface Snapshot {
    id: string
    post_id: string
    snapshot_date: string
    likes: number
    comments: number
    reposts: number
    impressions: number
}

interface PostWithMetrics extends Post {
    likes: number
    comments: number
    reposts: number
    impressions: number
    engagement: number
    engagementRate: number
    dayOfWeek: string
}

/* ───────────────────────── Helpers ───────────────────────── */

function fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return n.toLocaleString()
}

function truncUrl(url: string): string {
    const m = url.match(/activity:(\d+)/)
    return m ? `…${m[1].slice(-8)}` : url.slice(0, 25)
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

/* ────────────────────────── Page ─────────────────────────── */

export default function AdminPage() {
    const [posts, setPosts] = useState<Post[]>([])
    const [snapshots, setSnapshots] = useState<Snapshot[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

    // Fetch data from Supabase (reusable for initial load + refresh)
    const loadData = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true)
        try {
            const [pRes, sRes] = await Promise.all([
                supabase.from('linkedin_posts').select('*'),
                supabase.from('post_snapshots').select('*').order('snapshot_date', { ascending: false }),
            ])
            if (pRes.error) throw pRes.error
            if (sRes.error) throw sRes.error
            setPosts(pRes.data || [])
            setSnapshots(sRes.data || [])
            setLastUpdated(new Date())
        } catch (e: any) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [])

    // Initial load + real-time subscriptions
    useEffect(() => {
        loadData(true)

        // Subscribe to real-time changes on both tables
        const channel = supabase
            .channel('admin-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'linkedin_posts' }, () => {
                loadData()
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'post_snapshots' }, () => {
                loadData()
            })
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [loadData])

    /* ───── Computed ───── */

    const latestSnap = useMemo(() => {
        const m = new Map<string, Snapshot>()
        for (const s of snapshots) {
            if (!m.has(s.post_id)) m.set(s.post_id, s)
        }
        return m
    }, [snapshots])

    const pwm: PostWithMetrics[] = useMemo(() =>
        posts
            .map(p => {
                const s = latestSnap.get(p.id)
                const likes = s?.likes || 0, comments = s?.comments || 0
                const reposts = s?.reposts || 0, impressions = s?.impressions || 0
                const engagement = likes + comments + reposts
                const engagementRate = impressions > 0 ? (engagement / impressions) * 100 : 0
                // dayOfWeek not available since posted_at is raw LinkedIn string (e.g. '2w', '1d')
                return { ...p, likes, comments, reposts, impressions, engagement, engagementRate, dayOfWeek: '' }
            })
            // Exclude reposts of other people's content — LinkedIn shows 0 impressions for those
            .filter(p => p.impressions > 0)
        , [posts, latestSnap])

    // ── KPIs ──
    const totalPosts = pwm.length
    const totalImpr = pwm.reduce((s, p) => s + p.impressions, 0)
    const totalEng = pwm.reduce((s, p) => s + p.engagement, 0)
    const totalLikes = pwm.reduce((s, p) => s + p.likes, 0)
    const totalComments = pwm.reduce((s, p) => s + p.comments, 0)
    const totalReposts = pwm.reduce((s, p) => s + p.reposts, 0)
    const avgEngRate = totalImpr > 0 ? (totalEng / totalImpr) * 100 : 0
    const avgImprPerPost = totalPosts > 0 ? totalImpr / totalPosts : 0
    const avgLikesPerPost = totalPosts > 0 ? totalLikes / totalPosts : 0
    const avgCommentsPerPost = totalPosts > 0 ? totalComments / totalPosts : 0

    // ── Top 5 ──
    const top5 = useMemo(() => [...pwm].sort((a, b) => b.engagement - a.engagement).slice(0, 5), [pwm])

    // ── Engagement Breakdown (Donut) ──
    const donutData = useMemo(() => [
        { name: 'Likes', value: totalLikes, color: '#3b82f6' },
        { name: 'Comments', value: totalComments, color: '#10b981' },
        { name: 'Reposts', value: totalReposts, color: '#f59e0b' },
    ], [totalLikes, totalComments, totalReposts])

    // ── Top posts by impressions (replaces day-of-week since posted_at is now raw text) ──
    const dayStats = useMemo(() =>
        [...pwm]
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 7)
            .map((p, i) => ({
                day: `#${i + 1}`,
                posts: 1,
                avgEng: p.engagement,
                avgImpr: p.impressions,
                totalEng: p.engagement,
                totalImpr: p.impressions,
                label: p.posted_at,
            }))
        , [pwm])

    const bestDay = useMemo(() => dayStats[0] ?? null, [dayStats])

    // ── Bar Chart (per-post) — indexed in DB order ──
    const barData = useMemo(() =>
        pwm.map((p, i) => ({
            name: `#${i + 1}`, date: p.posted_at,
            Likes: p.likes, Comments: p.comments, Reposts: p.reposts,
            Impressions: p.impressions,
            'Eng Rate': parseFloat(p.engagementRate.toFixed(2)),
            'Total Eng': p.engagement,
        }))
        , [pwm])

    // ── Growth Trend — indexed by post order (no real dates available) ──
    const growthData = useMemo(() => {
        let cImpr = 0, cLikes = 0, cComments = 0
        return pwm.map((p, i) => {
            cImpr += p.impressions; cLikes += p.likes; cComments += p.comments
            return {
                date: p.posted_at || `Post ${i + 1}`, Posts: 1,
                Impressions: p.impressions, Likes: p.likes, Comments: p.comments, Reposts: p.reposts,
                'Cum. Impressions': cImpr, 'Cum. Likes': cLikes, 'Cum. Comments': cComments,
            }
        })
    }, [pwm])

    // ── Posting Frequency (estimated over 30-day window since posted_at is raw text) ──
    const postingFreq = useMemo(() => {
        if (pwm.length <= 1) return { postsPerWeek: 0, daySpan: 30 }
        const daySpan = 30
        return { postsPerWeek: parseFloat((pwm.length / (daySpan / 7)).toFixed(1)), daySpan }
    }, [pwm])

    // ── Above/Below Avg ──
    const aboveAvgCount = pwm.filter(p => p.engagement > (totalEng / totalPosts)).length
    const belowAvgCount = totalPosts - aboveAvgCount

    // ── Performance Score (0-100 radial) ──
    const perfScore = useMemo(() => {
        const engScore = Math.min(avgEngRate * 10, 100)     // up to 10% rate = 100
        const volScore = Math.min((totalPosts / 20) * 100, 100) // 20 posts = 100
        const freqScore = Math.min((postingFreq.postsPerWeek / 5) * 100, 100) // 5/wk = 100
        return Math.round((engScore * 0.4 + volScore * 0.3 + freqScore * 0.3))
    }, [avgEngRate, totalPosts, postingFreq])

    /* ───── Custom Tooltips ───── */

    const BarTip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null
        const d = payload[0]?.payload
        return (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-lg text-xs min-w-[200px]">
                <p className="font-bold text-gray-900 text-sm mb-0.5">Post {label}</p>
                <p className="text-gray-400 mb-2">{d?.date}</p>
                <div className="space-y-1">
                    <Row label="👁️ Impressions" val={d?.Impressions?.toLocaleString()} />
                    <Row label="👍 Likes" val={d?.Likes?.toLocaleString()} cls="text-blue-600" />
                    <Row label="💬 Comments" val={d?.Comments?.toLocaleString()} cls="text-emerald-600" />
                    <Row label="🔄 Reposts" val={d?.Reposts?.toLocaleString()} cls="text-amber-600" />
                    <hr className="my-1 border-gray-100" />
                    <Row label="🔥 Total" val={d?.['Total Eng']?.toLocaleString()} />
                    <Row label="📊 Rate" val={d?.['Eng Rate'] + '%'} cls="text-purple-600" />
                </div>
            </div>
        )
    }

    const GrowthTip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null
        const d = payload[0]?.payload
        return (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-lg text-xs min-w-[210px]">
                <p className="font-bold text-gray-900 text-sm mb-1">{label}</p>
                <p className="text-gray-400 text-[11px] mb-2">{d?.Posts} post{d?.Posts > 1 ? 's' : ''}</p>
                <div className="space-y-1">
                    <Row label="Impressions" val={d?.Impressions?.toLocaleString()} />
                    <Row label="Likes" val={d?.Likes?.toLocaleString()} cls="text-blue-600" />
                    <Row label="Comments" val={d?.Comments?.toLocaleString()} cls="text-emerald-600" />
                    <hr className="my-1 border-gray-100" />
                    <p className="text-gray-400 font-medium">Cumulative</p>
                    <Row label="Impressions" val={d?.['Cum. Impressions']?.toLocaleString()} />
                    <Row label="Likes" val={d?.['Cum. Likes']?.toLocaleString()} cls="text-blue-600" />
                    <Row label="Comments" val={d?.['Cum. Comments']?.toLocaleString()} cls="text-emerald-600" />
                </div>
            </div>
        )
    }

    /* ───── UI ───── */

    if (loading) return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
            <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-gray-500">Loading analytics…</span>
            </div>
        </div>
    )

    if (error) return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
            <div className="bg-red-50 border border-red-200 rounded-xl px-6 py-4">
                <p className="text-red-600 font-semibold text-sm">Error</p>
                <p className="text-red-500 mt-1 text-sm">{error}</p>
            </div>
        </div>
    )

    return (
        <div className="min-h-screen bg-gray-50/60 font-sans">
            {/* ─── Header ─── */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="max-w-[1400px] mx-auto px-6 lg:px-8 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-gray-900 tracking-tight">Analytics Dashboard</h1>
                            <p className="text-[11px] text-gray-400">LinkedIn Post Performance</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        {lastUpdated && (
                            <span className="text-[11px] text-gray-400 hidden md:block">
                                Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                        )}
                        <button onClick={() => loadData()} className="text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-1.5 font-medium transition-colors">
                            ↻ Refresh
                        </button>
                        <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-1.5">
                            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-xs text-emerald-600 font-medium">Live</span>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-8 space-y-6">

                {/* ═══════════ ROW 1: KPI CARDS ═══════════ */}
                <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                    <KPI title="Total Posts" value={fmt(totalPosts)} icon="📝" accent="blue" />
                    <KPI title="Impressions" value={fmt(totalImpr)} icon="👁️" accent="purple" />
                    <KPI title="Engagement" value={fmt(totalEng)} icon="🔥" accent="emerald" />
                    <KPI title="Eng. Rate" value={avgEngRate.toFixed(2) + '%'} icon="📊" accent="amber" />
                    <KPI title="Avg Impr/Post" value={fmt(Math.round(avgImprPerPost))} icon="📈" accent="violet" />
                    <KPI title="Avg Likes/Post" value={avgLikesPerPost.toFixed(1)} icon="👍" accent="sky" />
                    <KPI title="Avg Comments" value={avgCommentsPerPost.toFixed(1)} icon="💬" accent="teal" />
                    <KPI title="Posts/Week" value={String(postingFreq.postsPerWeek)} icon="📅" accent="rose" />
                </section>

                {/* ═══════════ ROW 2: SCORE + BREAKDOWN + BEST DAY ═══════════ */}
                <section className="grid grid-cols-1 md:grid-cols-3 gap-4">

                    {/* Performance Score */}
                    <Card title="Performance Score" subtitle="Composite score based on engagement, volume & frequency">
                        <div className="flex items-center justify-center py-4">
                            <div className="relative w-40 h-40">
                                <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                                    <circle cx="60" cy="60" r="52" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                                    <circle cx="60" cy="60" r="52" fill="none" stroke={perfScore >= 70 ? '#10b981' : perfScore >= 40 ? '#f59e0b' : '#ef4444'}
                                        strokeWidth="10" strokeLinecap="round"
                                        strokeDasharray={`${(perfScore / 100) * 327} 327`} />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-3xl font-extrabold text-gray-900">{perfScore}</span>
                                    <span className="text-[10px] text-gray-400 uppercase tracking-wider">out of 100</span>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-xs border-t border-gray-100 pt-3 mt-2">
                            <div><p className="text-gray-400">Engagement</p><p className="font-bold text-gray-700">{Math.min(Math.round(avgEngRate * 10), 100)}</p></div>
                            <div><p className="text-gray-400">Volume</p><p className="font-bold text-gray-700">{Math.min(Math.round((totalPosts / 20) * 100), 100)}</p></div>
                            <div><p className="text-gray-400">Frequency</p><p className="font-bold text-gray-700">{Math.min(Math.round((postingFreq.postsPerWeek / 5) * 100), 100)}</p></div>
                        </div>
                    </Card>

                    {/* Engagement Breakdown */}
                    <Card title="Engagement Breakdown" subtitle="Distribution of likes, comments & reposts">
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={donutData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                                        {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                                    </Pie>
                                    <Tooltip formatter={(v: number | undefined) => (v ?? 0).toLocaleString()} contentStyle={{ borderRadius: 10, fontSize: 12, border: '1px solid #e5e7eb' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="flex justify-center gap-5 text-xs mt-1">
                            {donutData.map(d => (
                                <span key={d.name} className="flex items-center gap-1.5">
                                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                                    <span className="text-gray-500">{d.name}</span>
                                    <span className="font-bold text-gray-700">{fmt(d.value)}</span>
                                </span>
                            ))}
                        </div>
                    </Card>

                    {/* Best Posting Day */}
                    <Card title="Best Posting Day" subtitle="Average engagement by day of the week">
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dayStats} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#cbd5e1' }} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ borderRadius: 10, fontSize: 11, border: '1px solid #e5e7eb' }}
                                        formatter={(v: number | undefined, name: string | undefined) => [(v ?? 0).toLocaleString(), name ?? '']} />
                                    <Bar dataKey="avgEng" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Avg Engagement" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        {bestDay && (
                            <div className="text-center mt-2 bg-blue-50 rounded-lg py-2">
                                <span className="text-xs text-blue-600 font-semibold">🏆 {bestDay.day} performs best — {bestDay.avgEng} avg engagement from {bestDay.posts} posts</span>
                            </div>
                        )}
                    </Card>
                </section>

                {/* ═══════════ ROW 3: IMPRESSIONS-ENGAGEMENT FUNNEL ═══════════ */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Funnel */}
                    <Card title="Impressions → Engagement Funnel" subtitle="How impressions convert into engagement actions">
                        <div className="space-y-3 py-4">
                            <FunnelBar label="Impressions" value={totalImpr} max={totalImpr} color="#8b5cf6" />
                            <FunnelBar label="Total Engagement" value={totalEng} max={totalImpr} color="#3b82f6" />
                            <FunnelBar label="Likes" value={totalLikes} max={totalImpr} color="#60a5fa" />
                            <FunnelBar label="Comments" value={totalComments} max={totalImpr} color="#10b981" />
                            <FunnelBar label="Reposts" value={totalReposts} max={totalImpr} color="#f59e0b" />
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs border-t border-gray-100 pt-3 mt-2">
                            <div className="text-center"><span className="text-gray-400">Impr → Engagement</span><p className="font-bold text-gray-700 text-sm">{avgEngRate.toFixed(2)}%</p></div>
                            <div className="text-center"><span className="text-gray-400">Impr → Comments</span><p className="font-bold text-gray-700 text-sm">{totalImpr > 0 ? ((totalComments / totalImpr) * 100).toFixed(2) : 0}%</p></div>
                        </div>
                    </Card>

                    {/* Above/Below Average */}
                    <Card title="Performance Distribution" subtitle="Posts performing above vs below average engagement">
                        <div className="flex items-center justify-center gap-8 py-6">
                            <div className="text-center">
                                <div className="w-20 h-20 rounded-full bg-emerald-50 border-4 border-emerald-200 flex items-center justify-center mb-2">
                                    <span className="text-2xl font-extrabold text-emerald-600">{aboveAvgCount}</span>
                                </div>
                                <p className="text-xs text-gray-500 font-medium">Above Avg</p>
                                <p className="text-[10px] text-gray-400">{totalPosts > 0 ? ((aboveAvgCount / totalPosts) * 100).toFixed(0) : 0}%</p>
                            </div>
                            <div className="text-center">
                                <div className="w-20 h-20 rounded-full bg-red-50 border-4 border-red-200 flex items-center justify-center mb-2">
                                    <span className="text-2xl font-extrabold text-red-500">{belowAvgCount}</span>
                                </div>
                                <p className="text-xs text-gray-500 font-medium">Below Avg</p>
                                <p className="text-[10px] text-gray-400">{totalPosts > 0 ? ((belowAvgCount / totalPosts) * 100).toFixed(0) : 0}%</p>
                            </div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3 text-center text-xs text-gray-500">
                            Average engagement per post: <span className="font-bold text-gray-900">{totalPosts > 0 ? (totalEng / totalPosts).toFixed(1) : 0}</span> interactions
                        </div>
                    </Card>
                </section>

                {/* ═══════════ ROW 4: TOP 5 POSTS ═══════════ */}
                <Card title="🏆 Top 5 Posts This Month" subtitle="Ranked by total engagement">
                    <div className="divide-y divide-gray-100 -mx-5 -mb-1 mt-2">
                        {top5.map((p, i) => {
                            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`
                            return (
                                <div key={p.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-2 hover:bg-gray-50/60 transition-colors">
                                    <span className="text-lg w-8 shrink-0 text-center">{medal}</span>
                                    <div className="flex-1 min-w-0">
                                        <a href={p.post_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs font-mono truncate block">{p.post_url}</a>
                                        <p className="text-[11px] text-gray-400 mt-0.5">{p.posted_at} · {p.engagementRate.toFixed(1)}% eng. rate</p>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs shrink-0">
                                        <Pill label="likes" val={p.likes} cls="text-blue-600" />
                                        <Pill label="comments" val={p.comments} cls="text-emerald-600" />
                                        <Pill label="reposts" val={p.reposts} cls="text-amber-600" />
                                        <Pill label="impr." val={p.impressions} cls="text-gray-900" />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </Card>

                {/* ═══════════ ROW 5: ENGAGEMENT BAR CHART ═══════════ */}
                <Card title="Engagement Per Post" subtitle="Stacked bars (left axis) with impressions line (right axis)">
                    <div className="h-96 mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={barData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                <YAxis yAxisId="L" tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'Engagement', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#94a3b8' } }} />
                                <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 10, fill: '#c4b5fd' }} label={{ value: 'Impressions', angle: 90, position: 'insideRight', style: { fontSize: 9, fill: '#c4b5fd' } }} />
                                <Tooltip content={<BarTip />} />
                                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                                <Bar yAxisId="L" dataKey="Likes" stackId="e" fill="#3b82f6" />
                                <Bar yAxisId="L" dataKey="Comments" stackId="e" fill="#10b981" />
                                <Bar yAxisId="L" dataKey="Reposts" stackId="e" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                                <Line yAxisId="R" dataKey="Impressions" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 4, fill: '#8b5cf6', stroke: '#fff', strokeWidth: 2 }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                {/* ═══════════ ROW 6: GROWTH TREND ═══════════ */}
                <Card title="Date-wise Growth Trend" subtitle="Daily metrics with cumulative running totals (dashed)">
                    <div className="h-96 mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={growthData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                <defs>
                                    <linearGradient id="gImpr" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.12} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.01} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} angle={-30} textAnchor="end" height={45} />
                                <YAxis yAxisId="L" tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'Daily', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#94a3b8' } }} />
                                <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 10, fill: '#d1d5db' }} label={{ value: 'Cumulative', angle: 90, position: 'insideRight', style: { fontSize: 9, fill: '#d1d5db' } }} />
                                <Tooltip content={<GrowthTip />} />
                                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                                <Area yAxisId="L" dataKey="Impressions" fill="url(#gImpr)" stroke="#8b5cf6" strokeWidth={2} name="Daily Impr." dot={{ r: 3, fill: '#8b5cf6' }} />
                                <Bar yAxisId="L" dataKey="Likes" fill="#3b82f6" fillOpacity={0.7} radius={[3, 3, 0, 0]} barSize={14} name="Daily Likes" />
                                <Bar yAxisId="L" dataKey="Comments" fill="#10b981" fillOpacity={0.7} radius={[3, 3, 0, 0]} barSize={14} name="Daily Comments" />
                                <Line yAxisId="R" dataKey="Cum. Impressions" stroke="#a78bfa" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Cum. Impr." />
                                <Line yAxisId="R" dataKey="Cum. Likes" stroke="#60a5fa" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Cum. Likes" />
                                <Line yAxisId="R" dataKey="Cum. Comments" stroke="#34d399" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Cum. Comments" />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                {/* ═══════════ ROW 7: PER-POST TABLE ═══════════ */}
                <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                        <div><h2 className="font-semibold text-gray-900">Per-Post Analysis</h2><p className="text-[11px] text-gray-400 mt-0.5">All posts sorted by date</p></div>
                        <span className="text-[10px] bg-gray-50 text-gray-400 px-2.5 py-1 rounded-full">{totalPosts} posts</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50/80 text-left">
                                    {['#', 'Date', 'Post', 'Impressions', 'Likes', 'Comments', 'Reposts', 'Eng.', 'Eng. Rate'].map(h => (
                                        <th key={h} className={`px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider ${['Impressions', 'Likes', 'Comments', 'Reposts', 'Eng.', 'Eng. Rate'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {pwm.map((p, i) => {
                                    const isAboveAvg = p.engagement > (totalEng / totalPosts)
                                    return (
                                        <tr key={p.id} className="hover:bg-blue-50/30 transition-colors">
                                            <td className="px-5 py-3 text-gray-400 font-mono text-xs">{i + 1}</td>
                                            <td className="px-5 py-3 text-gray-600 whitespace-nowrap text-xs">{p.posted_at || '—'}</td>
                                            <td className="px-5 py-3">
                                                <a href={p.post_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-mono text-[11px]">{truncUrl(p.post_url)}</a>
                                            </td>
                                            <td className="px-5 py-3 text-right font-semibold text-gray-900 text-xs">{p.impressions.toLocaleString()}</td>
                                            <td className="px-5 py-3 text-right font-semibold text-blue-600 text-xs">{p.likes.toLocaleString()}</td>
                                            <td className="px-5 py-3 text-right font-semibold text-emerald-600 text-xs">{p.comments.toLocaleString()}</td>
                                            <td className="px-5 py-3 text-right font-semibold text-amber-600 text-xs">{p.reposts.toLocaleString()}</td>
                                            <td className="px-5 py-3 text-right font-semibold text-gray-900 text-xs">{p.engagement}</td>
                                            <td className="px-5 py-3 text-right">
                                                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${isAboveAvg ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                                    {p.engagementRate.toFixed(1)}%
                                                </span>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                <footer className="text-center text-[11px] text-gray-300 py-8">
                    LinkedIn Analytics Dashboard · Next.js + Supabase + Recharts
                </footer>
            </main>
        </div>
    )
}

/* ── Reusable Components ── */

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 text-sm">{title}</h2>
            {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
            {children}
        </section>
    )
}

function KPI({ title, value, icon, accent }: { title: string; value: string; icon: string; accent: string }) {
    const colors: Record<string, string> = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100',
        purple: 'bg-purple-50 text-purple-700 border-purple-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
        violet: 'bg-violet-50 text-violet-700 border-violet-100',
        sky: 'bg-sky-50 text-sky-700 border-sky-100',
        teal: 'bg-teal-50 text-teal-700 border-teal-100',
        rose: 'bg-rose-50 text-rose-700 border-rose-100',
    }
    return (
        <div className={`rounded-xl border p-3.5 ${colors[accent] || colors.blue} transition-shadow hover:shadow-md`}>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-medium opacity-60 uppercase tracking-wider leading-tight">{title}</span>
                <span className="text-sm">{icon}</span>
            </div>
            <p className="text-xl font-extrabold leading-none">{value}</p>
        </div>
    )
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
    const pct = max > 0 ? (value / max) * 100 : 0
    return (
        <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-32 text-right shrink-0">{label}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700 flex items-center px-2" style={{ width: `${Math.max(pct, 3)}%`, background: color }}>
                    <span className="text-white text-[10px] font-bold whitespace-nowrap">{fmt(value)}</span>
                </div>
            </div>
            <span className="text-[10px] text-gray-400 w-12 shrink-0">{pct.toFixed(1)}%</span>
        </div>
    )
}

function Row({ label, val, cls }: { label: string; val: string; cls?: string }) {
    return <div className="flex justify-between"><span className="text-gray-500">{label}</span><span className={`font-bold ${cls || 'text-gray-900'}`}>{val}</span></div>
}

function Pill({ label, val, cls }: { label: string; val: number; cls: string }) {
    return <span className={`${cls} font-semibold`}>{val.toLocaleString()}<span className="text-gray-400 font-normal ml-0.5">{label}</span></span>
}
