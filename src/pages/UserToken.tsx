import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw, Copy, Activity, User, Settings, Shield, Clock, Users, Power, Ban } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { request as invoke } from '../utils/request';
import { showToast } from '../components/common/ToastContainer';
import { copyToClipboard } from '../utils/clipboard';

interface UserToken {
    id: string;
    token: string;
    username: string;
    description?: string;
    enabled: boolean;
    expires_type: string;
    expires_at?: number;
    duration_seconds?: number;
    activated_at?: number;
    max_ips: number;
    curfew_start?: string;
    curfew_end?: string;
    created_at: number;
    updated_at: number;
    last_used_at?: number;
    total_requests: number;
    total_tokens_used: number;
}

interface UserTokenStats {
    total_tokens: number;
    active_tokens: number;
    total_users: number;
    today_requests: number;
}

type TokenStatus = 'active' | 'pending' | 'expired' | 'disabled';

const UserToken: React.FC = () => {
    const { t } = useTranslation();
    const [tokens, setTokens] = useState<UserToken[]>([]);
    const [stats, setStats] = useState<UserTokenStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [creating, setCreating] = useState(false);

    // Edit State
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingToken, setEditingToken] = useState<UserToken | null>(null);
    const [editUsername, setEditUsername] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editMaxIps, setEditMaxIps] = useState(0);
    const [editCurfewStart, setEditCurfewStart] = useState('');
    const [editCurfewEnd, setEditCurfewEnd] = useState('');
    const [updating, setUpdating] = useState(false);
    const [renewType, setRenewType] = useState('');
    const [renewCustomValue, setRenewCustomValue] = useState(1);
    const [renewCustomUnit, setRenewCustomUnit] = useState('hour');

    // Create Form State
    const [newUsername, setNewUsername] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newExpiresType, setNewExpiresType] = useState('month');
    const [newMaxIps, setNewMaxIps] = useState(0);
    const [newCurfewStart, setNewCurfewStart] = useState('');
    const [newCurfewEnd, setNewCurfewEnd] = useState('');
    const [newCustomValue, setNewCustomValue] = useState(1);
    const [newCustomUnit, setNewCustomUnit] = useState('hour');

    const loadData = async () => {
        setLoading(true);
        try {
            const [tokensData, statsData] = await Promise.all([
                invoke<UserToken[]>('list_user_tokens'),
                invoke<UserTokenStats>('get_user_token_summary')
            ]);
            setTokens(tokensData);
            setStats(statsData);
        } catch (e) {
            console.error('Failed to load user tokens', e);
            showToast(t('common.load_failed') || 'Failed to load data', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleCreate = async () => {
        if (!newUsername) {
            showToast(t('user_token.username_required') || 'Username is required', 'error');
            return;
        }

        if (newExpiresType === 'custom' && (!newCustomValue || newCustomValue <= 0)) {
            showToast(t('user_token.custom_duration_required') || 'Please enter a valid duration', 'error');
            return;
        }

        setCreating(true);
        try {
            let durationSeconds: number | null = null;
            if (newExpiresType === 'custom') {
                const multiplier = newCustomUnit === 'hour' ? 3600 : 86400;
                durationSeconds = newCustomValue * multiplier;
            }

            await invoke('create_user_token', {
                request: {
                    username: newUsername,
                    expires_type: newExpiresType,
                    description: newDesc || null,
                    max_ips: newMaxIps,
                    curfew_start: newCurfewStart || null,
                    curfew_end: newCurfewEnd || null,
                    duration_seconds: durationSeconds
                }
            });
            showToast(t('common.create_success') || 'Created successfully', 'success');
            setShowCreateModal(false);
            setNewUsername('');
            setNewDesc('');
            setNewExpiresType('month');
            setNewMaxIps(0);
            setNewCurfewStart('');
            setNewCurfewEnd('');
            setNewCustomValue(1);
            setNewCustomUnit('hour');
            loadData();
        } catch (e) {
            console.error('Failed to create token', e);
            showToast(String(e), 'error');
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await invoke('delete_user_token', { id });
            showToast(t('common.delete_success') || 'Deleted successfully', 'success');
            loadData();
        } catch (e) {
            showToast(String(e), 'error');
        }
    };

    const handleEdit = (token: UserToken) => {
        setEditingToken(token);
        setEditUsername(token.username);
        setEditDesc(token.description || '');
        setEditMaxIps(token.max_ips ?? 0);
        setEditCurfewStart(token.curfew_start ?? '');
        setEditCurfewEnd(token.curfew_end ?? '');
        setRenewType('');
        setRenewCustomValue(1);
        setRenewCustomUnit('hour');
        setShowEditModal(true);
    };

    const handleUpdate = async () => {
        if (!editingToken) return;
        if (!editUsername) {
            showToast(t('user_token.username_required') || 'Username is required', 'error');
            return;
        }

        if (renewType === 'custom' && (!renewCustomValue || renewCustomValue <= 0)) {
            showToast(t('user_token.custom_duration_required') || 'Please enter a valid duration', 'error');
            return;
        }

        setUpdating(true);
        try {
            await invoke('update_user_token', {
                id: editingToken.id,
                request: {
                    username: editUsername,
                    description: editDesc || undefined,
                    max_ips: editMaxIps,
                    curfew_start: editCurfewStart === '' ? null : editCurfewStart,
                    curfew_end: editCurfewEnd === '' ? null : editCurfewEnd
                }
            });

            // 如果选择了续期
            if (renewType) {
                let customDuration: number | undefined;
                if (renewType === 'custom') {
                    const multiplier = renewCustomUnit === 'hour' ? 3600 : 86400;
                    customDuration = renewCustomValue * multiplier;
                }
                await handleRenew(editingToken.id, renewType, customDuration);
            }

            showToast(t('common.update_success') || 'Updated successfully', 'success');
            setShowEditModal(false);
            setEditingToken(null);
            loadData();
        } catch (e) {
            console.error('Failed to update token', e);
            showToast(String(e), 'error');
        } finally {
            setUpdating(false);
        }
    };

    const handleRenew = async (id: string, type: string, customDuration?: number) => {
        try {
            await invoke('renew_user_token', { id, expiresType: type, customDuration: customDuration || null });
            showToast(t('user_token.renew_success') || 'Renewed successfully', 'success');
            loadData();
        } catch (e) {
            showToast(String(e), 'error');
        }
    };

    const handleToggleEnabled = async (token: UserToken) => {
        try {
            await invoke('update_user_token', {
                id: token.id,
                request: {
                    enabled: !token.enabled
                }
            });
            showToast(
                token.enabled
                    ? (t('user_token.disabled_success') || 'Token disabled')
                    : (t('user_token.enabled_success') || 'Token enabled'),
                'success'
            );
            loadData();
        } catch (e) {
            showToast(String(e), 'error');
        }
    };

    const handleCopyToken = async (text: string) => {
        const success = await copyToClipboard(text);
        if (success) {
            showToast(t('common.copied') || 'Copied to clipboard', 'success');
        } else {
            showToast(t('common.copy_failed') || 'Failed to copy to clipboard', 'error');
        }
    };

    const formatTime = (ts?: number) => {
        if (!ts) return '-';
        return new Date(ts * 1000).toLocaleString();
    };

    const getTokenStatus = (token: UserToken): TokenStatus => {
        if (!token.enabled) return 'disabled';
        if (token.expires_at && token.expires_at < Date.now() / 1000) return 'expired';
        if (token.duration_seconds && !token.activated_at) return 'pending';
        return 'active';
    };

    const getStatusBadge = (status: TokenStatus) => {
        switch (status) {
            case 'active':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border border-green-100 dark:border-green-900/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        {t('user_token.status_active', { defaultValue: 'Active' })}
                    </span>
                );
            case 'pending':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {t('user_token.status_pending', { defaultValue: 'Pending' })}
                    </span>
                );
            case 'expired':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        {t('user_token.status_expired', { defaultValue: 'Expired' })}
                    </span>
                );
            case 'disabled':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                        {t('user_token.status_disabled', { defaultValue: 'Disabled' })}
                    </span>
                );
        }
    };

    const formatDuration = (seconds: number) => {
        if (seconds >= 86400) {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            return hours > 0
                ? `${days}${t('user_token.unit_day_short', { defaultValue: 'd' })} ${hours}${t('user_token.unit_hour_short', { defaultValue: 'h' })}`
                : `${days}${t('user_token.unit_day_short', { defaultValue: 'd' })}`;
        }
        if (seconds >= 3600) {
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            return mins > 0
                ? `${hours}${t('user_token.unit_hour_short', { defaultValue: 'h' })} ${mins}${t('user_token.unit_min_short', { defaultValue: 'm' })}`
                : `${hours}${t('user_token.unit_hour_short', { defaultValue: 'h' })}`;
        }
        return `${Math.floor(seconds / 60)}${t('user_token.unit_min_short', { defaultValue: 'm' })}`;
    };

    const formatRemaining = (expiresAt: number) => {
        const remaining = expiresAt - Date.now() / 1000;
        if (remaining <= 0) return t('user_token.already_expired', { defaultValue: 'Expired' });
        return formatDuration(remaining);
    };

    const getExpiresLabel = (type: string) => {
        switch (type) {
            case 'hour': return t('user_token.expires_hour', { defaultValue: '1 Hour' });
            case 'day': return t('user_token.expires_day', { defaultValue: '1 Day' });
            case '3day': return t('user_token.expires_3day', { defaultValue: '3 Days' });
            case 'week': return t('user_token.expires_week', { defaultValue: '1 Week' });
            case 'month': return t('user_token.expires_month', { defaultValue: '1 Month' });
            case 'never': return t('user_token.expires_never', { defaultValue: 'Never' });
            case 'custom': return t('user_token.expires_custom', { defaultValue: 'Custom' });
            default: return type;
        }
    };

    const getExpiresDisplay = (token: UserToken) => {
        const status = getTokenStatus(token);
        if (status === 'disabled') {
            return (
                <div className="text-xs text-gray-400">
                    {token.duration_seconds
                        ? `${t('user_token.duration_label', { defaultValue: 'Duration' })}: ${formatDuration(token.duration_seconds)}`
                        : t('user_token.never', { defaultValue: 'Never' })
                    }
                </div>
            );
        }
        if (token.expires_type === 'never' || (!token.duration_seconds && !token.expires_at)) {
            return <div className="text-xs text-green-500 font-medium">{t('user_token.never', { defaultValue: 'Never' })}</div>;
        }
        if (status === 'pending') {
            return (
                <div>
                    <div className="text-xs text-amber-500 font-medium">
                        {t('user_token.await_activation', { defaultValue: 'Awaiting activation' })}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                        {t('user_token.duration_label', { defaultValue: 'Duration' })}: {formatDuration(token.duration_seconds!)}
                    </div>
                </div>
            );
        }
        if (status === 'expired') {
            return (
                <div>
                    <div className="text-xs text-red-500 font-bold">
                        {t('user_token.already_expired', { defaultValue: 'Expired' })}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{formatTime(token.expires_at)}</div>
                </div>
            );
        }
        // active with expiry
        if (token.expires_at) {
            const remaining = token.expires_at - Date.now() / 1000;
            const colorClass = remaining < 86400 * 3 ? 'text-orange-500' : 'text-green-500';
            return (
                <div>
                    <div className={`text-xs font-medium ${colorClass}`}>
                        {t('user_token.remaining', { defaultValue: 'Remaining' })}: {formatRemaining(token.expires_at)}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                        {t('user_token.activated_at_label', { defaultValue: 'Activated' })}: {formatTime(token.activated_at)}
                    </div>
                </div>
            );
        }
        return <div className="text-xs text-green-500 font-medium">{t('user_token.never', { defaultValue: 'Never' })}</div>;
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="h-full flex flex-col p-5 gap-5 max-w-7xl mx-auto w-full"
        >
            {/* Header */}
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                        <User className="text-purple-500 w-5 h-5" />
                    </div>
                    {t('user_token.title', { defaultValue: 'User Tokens' })}
                </h1>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => loadData()}
                        className={`p-2 hover:bg-gray-100 dark:hover:bg-base-200 rounded-lg transition-colors ${loading ? 'text-blue-500' : 'text-gray-500'}`}
                        title={t('common.refresh') || 'Refresh'}
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-all flex items-center gap-2 shadow-sm shadow-blue-500/20"
                    >
                        <Plus size={16} />
                        <span>{t('user_token.create', { defaultValue: 'Create Token' })}</span>
                    </button>
                </div>
            </div>

            {/* Stats Cards Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <motion.div
                    whileHover={{ y: -2 }}
                    className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                            <Users className="w-4 h-4 text-blue-500" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-base-content mb-0.5">{stats?.total_users || 0}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('user_token.total_users', { defaultValue: 'Total Users' })}</div>
                </motion.div>

                <motion.div
                    whileHover={{ y: -2 }}
                    className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="p-1.5 bg-green-50 dark:bg-green-900/20 rounded-md">
                            <Activity className="w-4 h-4 text-green-500" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-base-content mb-0.5">{stats?.active_tokens || 0}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('user_token.active_tokens', { defaultValue: 'Active Tokens' })}</div>
                </motion.div>

                <motion.div
                    whileHover={{ y: -2 }}
                    className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="p-1.5 bg-purple-50 dark:bg-purple-900/20 rounded-md">
                            <Clock className="w-4 h-4 text-purple-500" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-base-content mb-0.5">{stats?.total_tokens || 0}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('user_token.total_created', { defaultValue: 'Total Tokens' })}</div>
                </motion.div>

                <motion.div
                    whileHover={{ y: -2 }}
                    className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="p-1.5 bg-orange-50 dark:bg-orange-900/20 rounded-md">
                            <Shield className="w-4 h-4 text-orange-500" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-base-content mb-0.5">{stats?.today_requests || 0}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('user_token.today_requests', { defaultValue: 'Today Requests' })}</div>
                </motion.div>
            </div>

            {/* Token List */}
            <div className="flex-1 overflow-auto bg-white dark:bg-base-100 rounded-2xl shadow-sm border border-gray-100 dark:border-base-200">
                <table className="table table-pin-rows">
                    <thead>
                        <tr className="bg-gray-50/50 dark:bg-base-200/50">
                            <th className="bg-transparent text-gray-500 font-medium py-4">{t('user_token.username', { defaultValue: 'Username' })}</th>
                            <th className="bg-transparent text-gray-500 font-medium py-4">{t('user_token.status', { defaultValue: 'Status' })}</th>
                            <th className="bg-transparent text-gray-500 font-medium py-4">{t('user_token.token', { defaultValue: 'Token' })}</th>
                            <th className="bg-transparent text-gray-500 font-medium py-4">{t('user_token.expires', { defaultValue: 'Expires' })}</th>
                            <th className="bg-transparent text-gray-500 font-medium py-4">{t('user_token.usage', { defaultValue: 'Usage' })}</th>
                            <th className="bg-transparent text-gray-500 font-medium py-4">{t('user_token.ip_limit', { defaultValue: 'IP Limit' })}</th>
                            <th className="bg-transparent text-gray-500 font-medium py-4">{t('user_token.created', { defaultValue: 'Created' })}</th>
                            <th className="bg-transparent text-gray-500 font-medium py-4 text-right">{t('common.actions', { defaultValue: 'Actions' })}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-base-200">
                        <AnimatePresence mode="popLayout">
                            {tokens.map((token, index) => {
                                const status = getTokenStatus(token);
                                return (
                                    <motion.tr
                                        key={token.id}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        transition={{ delay: index * 0.03 }}
                                        className={`hover:bg-white/[0.03] transition-colors group ${status === 'disabled' ? 'opacity-50' : ''}`}
                                    >
                                        <td className="py-3 h-16">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center text-purple-600 font-bold text-xs">
                                                    {token.username.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-gray-900 dark:text-white uppercase tracking-wider text-xs">{token.username}</div>
                                                    <div className="text-[10px] text-gray-500">{token.description || '-'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            {getStatusBadge(status)}
                                        </td>
                                        <td>
                                            <div className="flex items-center gap-2 group/token">
                                                <code className="bg-gray-50 dark:bg-base-200 px-2 py-1 rounded border border-gray-100 dark:border-base-300 text-[11px] font-mono text-gray-600 dark:text-gray-400">
                                                    {token.token.substring(0, 8)}••••••••
                                                </code>
                                                <button
                                                    onClick={() => handleCopyToken(token.token)}
                                                    className="p-1.5 hover:bg-gray-200 dark:hover:bg-base-300 rounded-md transition-all text-gray-400 hover:text-gray-600 dark:hover:text-white"
                                                >
                                                    <Copy size={13} />
                                                </button>
                                            </div>
                                        </td>
                                        <td>
                                            <div className="min-h-[32px] flex flex-col justify-center">
                                                {getExpiresDisplay(token)}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-base-200 text-gray-500 rounded lowercase">
                                                    {getExpiresLabel(token.expires_type)}
                                                </span>
                                                {status === 'expired' && (
                                                    <button
                                                        onClick={() => handleRenew(token.id, token.expires_type)}
                                                        className="text-[10px] text-blue-500 hover:underline font-medium"
                                                    >
                                                        {t('user_token.renew_button', { defaultValue: 'Renew' })}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">{token.total_requests} <span className="text-[10px] font-normal text-gray-400">reqs</span></div>
                                            <div className="text-[10px] text-gray-400 mt-0.5">
                                                {(token.total_tokens_used / 1000).toFixed(1)}k tokens
                                            </div>
                                        </td>
                                        <td>
                                            {token.max_ips === 0
                                                ? <span className="px-2 py-0.5 bg-gray-100 dark:bg-base-200 text-gray-500 text-[10px] rounded-full">{t('user_token.unlimited', { defaultValue: 'Unlimited' })}</span>
                                                : <span className="px-2 py-0.5 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-[10px] font-medium rounded-full border border-orange-100 dark:border-orange-900/30">{token.max_ips} IPs</span>
                                            }
                                            {token.curfew_start && token.curfew_end && (
                                                <div className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-1 bg-gray-50 dark:bg-base-200 w-fit px-1.5 py-0.5 rounded">
                                                    <Clock size={10} className="text-orange-500" />
                                                    <span>{token.curfew_start} - {token.curfew_end}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="text-[10px] text-gray-400 italic">
                                            {formatTime(token.created_at)}
                                        </td>
                                        <td className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <button
                                                    onClick={() => handleToggleEnabled(token)}
                                                    className={`p-1.5 rounded-lg transition-colors ${
                                                        token.enabled
                                                            ? 'text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20'
                                                            : 'text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20'
                                                    }`}
                                                    title={token.enabled
                                                        ? (t('user_token.disable', { defaultValue: 'Disable' }))
                                                        : (t('user_token.enable', { defaultValue: 'Enable' }))
                                                    }
                                                >
                                                    {token.enabled ? <Power size={14} /> : <Ban size={14} />}
                                                </button>
                                                <button
                                                    onClick={() => handleEdit(token)}
                                                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-base-200 rounded-lg text-gray-500 hover:text-blue-500 transition-colors"
                                                    title={t('common.edit', { defaultValue: 'Edit' })}
                                                >
                                                    <Settings size={14} />
                                                </button>
                                                <div className="dropdown dropdown-end">
                                                    <label tabIndex={0} className="p-1.5 hover:bg-gray-100 dark:hover:bg-base-200 rounded-lg text-gray-500 hover:text-green-500 transition-colors inline-block cursor-pointer">
                                                        <RefreshCw size={14} />
                                                    </label>
                                                    <ul tabIndex={0} className="dropdown-content z-[10] menu p-2 shadow-xl bg-white dark:bg-base-100 rounded-xl w-32 border border-gray-100 dark:border-base-200 mt-1">
                                                        <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('user_token.renew')}</div>
                                                        <li><a className="text-xs py-2" onClick={() => handleRenew(token.id, 'hour')}>{t('user_token.expires_hour', { defaultValue: '1 Hour' })}</a></li>
                                                        <li><a className="text-xs py-2" onClick={() => handleRenew(token.id, 'day')}>{t('user_token.expires_day', { defaultValue: '1 Day' })}</a></li>
                                                        <li><a className="text-xs py-2" onClick={() => handleRenew(token.id, '3day')}>{t('user_token.expires_3day', { defaultValue: '3 Days' })}</a></li>
                                                        <li><a className="text-xs py-2" onClick={() => handleRenew(token.id, 'week')}>{t('user_token.expires_week', { defaultValue: '1 Week' })}</a></li>
                                                        <li><a className="text-xs py-2" onClick={() => handleRenew(token.id, 'month')}>{t('user_token.expires_month', { defaultValue: '1 Month' })}</a></li>
                                                    </ul>
                                                </div>
                                                <button
                                                    onClick={() => handleDelete(token.id)}
                                                    className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </motion.tr>
                                );
                            })}
                        </AnimatePresence>
                        {tokens.length === 0 && !loading && (
                            <tr>
                                <td colSpan={8} className="py-20">
                                    <div className="flex flex-col items-center justify-center text-gray-400 gap-3">
                                        <div className="p-4 bg-gray-50 dark:bg-base-200 rounded-full">
                                            <Users size={40} className="opacity-20" />
                                        </div>
                                        <p className="text-sm">{t('user_token.no_data', { defaultValue: 'No tokens found' })}</p>
                                        <button
                                            onClick={() => setShowCreateModal(true)}
                                            className="text-xs text-blue-500 hover:underline"
                                        >
                                            {t('user_token.create', { defaultValue: 'Create your first token' })}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="modal modal-open">
                    <div className="modal-box">
                        <h3 className="font-bold text-lg mb-4">{t('user_token.create_title', { defaultValue: 'Create New Token' })}</h3>

                        <div className="form-control w-full mb-3">
                            <label className="label">
                                <span className="label-text">{t('user_token.username', { defaultValue: 'Username' })} *</span>
                            </label>
                            <input
                                type="text"
                                className="input input-bordered w-full"
                                value={newUsername}
                                onChange={e => setNewUsername(e.target.value)}
                                placeholder={t('user_token.placeholder_username', { defaultValue: 'e.g. user1' })}
                            />
                        </div>

                        <div className="form-control w-full mb-3">
                            <label className="label">
                                <span className="label-text">{t('user_token.description', { defaultValue: 'Description' })}</span>
                            </label>
                            <input
                                type="text"
                                className="input input-bordered w-full"
                                value={newDesc}
                                onChange={e => setNewDesc(e.target.value)}
                                placeholder={t('user_token.placeholder_desc', { defaultValue: 'Optional notes' })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-3">
                            <div className="form-control w-full">
                                <label className="label">
                                    <span className="label-text">{t('user_token.duration', { defaultValue: 'Duration' })}</span>
                                </label>
                                <select
                                    className="select select-bordered w-full"
                                    value={newExpiresType}
                                    onChange={e => setNewExpiresType(e.target.value)}
                                >
                                    <option value="hour">{t('user_token.expires_hour', { defaultValue: '1 Hour' })}</option>
                                    <option value="day">{t('user_token.expires_day', { defaultValue: '1 Day' })}</option>
                                    <option value="3day">{t('user_token.expires_3day', { defaultValue: '3 Days' })}</option>
                                    <option value="week">{t('user_token.expires_week', { defaultValue: '1 Week' })}</option>
                                    <option value="month">{t('user_token.expires_month', { defaultValue: '1 Month' })}</option>
                                    <option value="custom">{t('user_token.expires_custom', { defaultValue: 'Custom' })}</option>
                                    <option value="never">{t('user_token.expires_never', { defaultValue: 'Never' })}</option>
                                </select>
                                <label className="label">
                                    <span className="label-text-alt text-gray-500">{t('user_token.hint_duration', { defaultValue: 'Starts counting from first request' })}</span>
                                </label>
                            </div>

                            <div className="form-control w-full">
                                <label className="label">
                                    <span className="label-text">{t('user_token.ip_limit', { defaultValue: 'Max IPs' })}</span>
                                </label>
                                <input
                                    type="number"
                                    className="input input-bordered w-full"
                                    value={newMaxIps}
                                    onChange={e => setNewMaxIps(parseInt(e.target.value) || 0)}
                                    min="0"
                                    placeholder={t('user_token.placeholder_max_ips', { defaultValue: '0 = Unlimited' })}
                                />
                                <label className="label">
                                    <span className="label-text-alt text-gray-500">{t('user_token.hint_max_ips', { defaultValue: '0 = Unlimited' })}</span>
                                </label>
                            </div>
                        </div>

                        {/* Custom Duration Input */}
                        {newExpiresType === 'custom' && (
                            <div className="form-control w-full mb-3">
                                <label className="label">
                                    <span className="label-text">{t('user_token.custom_duration', { defaultValue: 'Custom Duration' })} *</span>
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        className="input input-bordered flex-1"
                                        value={newCustomValue}
                                        onChange={e => setNewCustomValue(parseInt(e.target.value) || 0)}
                                        min="1"
                                        placeholder="1"
                                    />
                                    <select
                                        className="select select-bordered w-28"
                                        value={newCustomUnit}
                                        onChange={e => setNewCustomUnit(e.target.value)}
                                    >
                                        <option value="hour">{t('user_token.unit_hours', { defaultValue: 'Hours' })}</option>
                                        <option value="day">{t('user_token.unit_days', { defaultValue: 'Days' })}</option>
                                    </select>
                                </div>
                                <label className="label">
                                    <span className="label-text-alt text-gray-500">{t('user_token.hint_custom_duration', { defaultValue: 'Enter the number and unit for token validity period' })}</span>
                                </label>
                            </div>
                        )}

                        <div className="form-control w-full mb-3">
                            <label className="label">
                                <span className="label-text">{t('user_token.curfew', { defaultValue: 'Curfew (Service Unavailable Time)' })}</span>
                            </label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="time"
                                    className="input input-bordered w-full"
                                    value={newCurfewStart}
                                    onChange={e => setNewCurfewStart(e.target.value)}
                                />
                                <span className="text-gray-400">to</span>
                                <input
                                    type="time"
                                    className="input input-bordered w-full"
                                    value={newCurfewEnd}
                                    onChange={e => setNewCurfewEnd(e.target.value)}
                                />
                            </div>
                            <label className="label">
                                <span className="label-text-alt text-gray-500">{t('user_token.hint_curfew', { defaultValue: 'Leave empty to disable. Based on Beijing time (UTC+8).' })}</span>
                            </label>
                        </div>

                        <div className="modal-action">
                            <button className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-base-200 rounded-lg text-sm transition-colors" onClick={() => setShowCreateModal(false)}>
                                {t('common.cancel', { defaultValue: 'Cancel' })}
                            </button>
                            <button
                                className={`px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-all shadow-sm shadow-blue-500/20 flex items-center gap-2 ${creating ? 'opacity-50 cursor-not-allowed' : ''}`}
                                onClick={handleCreate}
                                disabled={creating}
                            >
                                {creating && <RefreshCw size={14} className="animate-spin" />}
                                {t('common.create', { defaultValue: 'Create' })}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {showEditModal && editingToken && (
                <div className="modal modal-open">
                    <div className="modal-box">
                        <h3 className="font-bold text-lg mb-4">{t('user_token.edit_title', { defaultValue: 'Edit Token' })}</h3>

                        <div className="form-control w-full mb-3">
                            <label className="label">
                                <span className="label-text">{t('user_token.username', { defaultValue: 'Username' })} *</span>
                            </label>
                            <input
                                type="text"
                                className="input input-bordered w-full"
                                value={editUsername}
                                onChange={e => setEditUsername(e.target.value)}
                                placeholder={t('user_token.placeholder_username', { defaultValue: 'e.g. user1' })}
                            />
                        </div>

                        <div className="form-control w-full mb-3">
                            <label className="label">
                                <span className="label-text">{t('user_token.description', { defaultValue: 'Description' })}</span>
                            </label>
                            <input
                                type="text"
                                className="input input-bordered w-full"
                                value={editDesc}
                                onChange={e => setEditDesc(e.target.value)}
                                placeholder={t('user_token.placeholder_desc', { defaultValue: 'Optional notes' })}
                            />
                        </div>

                        <div className="form-control w-full mb-3">
                            <label className="label">
                                <span className="label-text">{t('user_token.ip_limit', { defaultValue: 'Max IPs' })}</span>
                            </label>
                            <input
                                type="number"
                                className="input input-bordered w-full"
                                value={editMaxIps}
                                onChange={e => setEditMaxIps(parseInt(e.target.value) || 0)}
                                min="0"
                                placeholder={t('user_token.placeholder_max_ips', { defaultValue: '0 = Unlimited' })}
                            />
                            <label className="label">
                                <span className="label-text-alt text-gray-500">{t('user_token.hint_max_ips', { defaultValue: '0 = Unlimited' })}</span>
                            </label>
                        </div>

                        <div className="form-control w-full mb-3">
                            <label className="label">
                                <span className="label-text">{t('user_token.curfew', { defaultValue: 'Curfew (Service Unavailable Time)' })}</span>
                            </label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="time"
                                    className="input input-bordered w-full"
                                    value={editCurfewStart}
                                    onChange={e => setEditCurfewStart(e.target.value)}
                                />
                                <span className="text-gray-400">to</span>
                                <input
                                    type="time"
                                    className="input input-bordered w-full"
                                    value={editCurfewEnd}
                                    onChange={e => setEditCurfewEnd(e.target.value)}
                                />
                            </div>
                            <label className="label">
                                <span className="label-text-alt text-gray-500">{t('user_token.hint_curfew', { defaultValue: 'Leave empty to disable. Based on Beijing time (UTC+8).' })}</span>
                            </label>
                        </div>

                        {/* Renew Section */}
                        {editingToken.expires_type !== 'never' && (
                            <div className="form-control w-full mb-3">
                                <label className="label">
                                    <span className="label-text">{t('user_token.renew', { defaultValue: 'Renew' })}</span>
                                    <span className="label-text-alt text-gray-500">
                                        {(() => {
                                            const s = getTokenStatus(editingToken);
                                            if (s === 'pending') return t('user_token.status_pending', { defaultValue: 'Pending' });
                                            if (s === 'expired') return t('user_token.status_expired', { defaultValue: 'Expired' });
                                            if (editingToken.expires_at) return `${t('user_token.remaining', { defaultValue: 'Remaining' })}: ${formatRemaining(editingToken.expires_at)}`;
                                            return '';
                                        })()}
                                    </span>
                                </label>
                                <select
                                    className="select select-bordered w-full"
                                    value={renewType}
                                    onChange={e => setRenewType(e.target.value)}
                                >
                                    <option value="">{t('user_token.renew_none', { defaultValue: 'No renewal' })}</option>
                                    <option value="hour">{t('user_token.expires_hour', { defaultValue: '1 Hour' })}</option>
                                    <option value="day">{t('user_token.expires_day', { defaultValue: '1 Day' })}</option>
                                    <option value="3day">{t('user_token.expires_3day', { defaultValue: '3 Days' })}</option>
                                    <option value="week">{t('user_token.expires_week', { defaultValue: '1 Week' })}</option>
                                    <option value="month">{t('user_token.expires_month', { defaultValue: '1 Month' })}</option>
                                    <option value="custom">{t('user_token.expires_custom', { defaultValue: 'Custom' })}</option>
                                </select>
                                <label className="label">
                                    <span className="label-text-alt text-gray-500">
                                        {getTokenStatus(editingToken) === 'expired' || getTokenStatus(editingToken) === 'pending'
                                            ? t('user_token.hint_renew_reset', { defaultValue: 'Will reset to pending activation' })
                                            : t('user_token.hint_renew_add', { defaultValue: 'Will add to remaining time' })
                                        }
                                    </span>
                                </label>
                                {renewType === 'custom' && (
                                    <div className="flex gap-2 mt-2">
                                        <input
                                            type="number"
                                            className="input input-bordered flex-1"
                                            value={renewCustomValue}
                                            onChange={e => setRenewCustomValue(parseInt(e.target.value) || 0)}
                                            min="1"
                                            placeholder="1"
                                        />
                                        <select
                                            className="select select-bordered w-28"
                                            value={renewCustomUnit}
                                            onChange={e => setRenewCustomUnit(e.target.value)}
                                        >
                                            <option value="hour">{t('user_token.unit_hours', { defaultValue: 'Hours' })}</option>
                                            <option value="day">{t('user_token.unit_days', { defaultValue: 'Days' })}</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="modal-action">
                            <button className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-base-200 rounded-lg text-sm transition-colors" onClick={() => setShowEditModal(false)}>
                                {t('common.cancel', { defaultValue: 'Cancel' })}
                            </button>
                            <button
                                className={`px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-all shadow-sm shadow-blue-500/20 flex items-center gap-2 ${updating ? 'opacity-50 cursor-not-allowed' : ''}`}
                                onClick={handleUpdate}
                                disabled={updating}
                            >
                                {updating && <RefreshCw size={14} className="animate-spin" />}
                                {t('common.update', { defaultValue: 'Update' })}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </motion.div>
    );
};
export default UserToken;
