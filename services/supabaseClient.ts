import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Bersihkan data penyimpanan manual lama jika ada di browser
try {
  localStorage.removeItem('dupoin_custom_supabase_url');
  localStorage.removeItem('dupoin_custom_supabase_anon_key');
} catch {}

// Kredensial langsung dan murni dari Environment Variables Vercel
const ENV_SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string) || '').trim();
const ENV_SUPABASE_ANON_KEY = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '').trim();

const FALLBACK_URL = 'https://jlpthxzpiqaexjpdzcsl.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmeHV5Z2RydWxxaGdkY3ZxbnR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MjgzNzMsImV4cCI6MjA4MjIwNDM3M30.KPddJd_xsE7zDLpz-X3Bd25fE8tWnnGEYeceFfhpt8Q';

export const isSupabaseConfigured = (): boolean => {
  return (
    Boolean(ENV_SUPABASE_URL) &&
    ENV_SUPABASE_URL.startsWith('https://') &&
    !ENV_SUPABASE_URL.includes('jlpthxzpiqaexjpdzcsl') &&
    Boolean(ENV_SUPABASE_ANON_KEY) &&
    ENV_SUPABASE_ANON_KEY.length > 20
  );
};

export const getSupabaseConfig = (): { url: string; anonKey: string; isCustom: boolean } => {
  const isConfigured = isSupabaseConfigured();
  return {
    url: isConfigured ? ENV_SUPABASE_URL : FALLBACK_URL,
    anonKey: isConfigured ? ENV_SUPABASE_ANON_KEY : FALLBACK_ANON_KEY,
    isCustom: isConfigured,
  };
};

const activeUrl = isSupabaseConfigured() ? ENV_SUPABASE_URL : FALLBACK_URL;
const activeKey = isSupabaseConfigured() ? ENV_SUPABASE_ANON_KEY : FALLBACK_ANON_KEY;

export const supabase: SupabaseClient = createClient(activeUrl, activeKey);

// Stubs untuk kompatibilitas jika dipanggil modul lama
export const updateSupabaseConfig = (_url: string, _anonKey: string): { success: boolean; error?: string } => {
  return { success: true };
};

export const resetSupabaseConfig = (): void => {};

/**
 * Test Supabase connection against the configured Vercel instance.
 */
export const testSupabaseConnection = async (): Promise<{ success: boolean; message: string; details?: any }> => {
  const config = getSupabaseConfig();

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      message: 'Variabel lingkungan Vercel belum terhubung. Tambahkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di dashboard Vercel (Project > Settings > Environment Variables) lalu Redeploy.',
      details: { isDefaultUrl: true }
    };
  }

  try {
    const healthTimeout = new Promise<Response>((_, reject) => 
      setTimeout(() => reject(new Error('Koneksi timeout (>4s). Pastikan URL Supabase benar dan project Supabase tidak dalam status paused.')), 4000)
    );

    try {
      const healthFetch = fetch(`${config.url}/auth/v1/health`, {
        headers: { apikey: config.anonKey }
      });
      await Promise.race([healthFetch, healthTimeout]);
    } catch (netErr: any) {
      return {
        success: false,
        message: `Gagal menjangkau server Supabase (${netErr?.message || netErr}). Periksa kembali VITE_SUPABASE_URL di Vercel.`,
        details: { networkError: true }
      };
    }

    const timeoutPromise = new Promise<{ data: any; error: any }>((_, reject) => 
      setTimeout(() => reject(new Error('Koneksi timeout saat query tabel')), 4000)
    );
    const queryPromise = supabase.from('profiles').select('id').limit(1);

    const { error: queryError } = await Promise.race([queryPromise, timeoutPromise]) as any;

    if (queryError) {
      if (queryError.code === '42P01' || queryError.message?.toLowerCase().includes('does not exist')) {
        return {
          success: true,
          message: 'Berhasil terhubung ke Supabase dari Vercel! Namun tabel "public.profiles" belum dibuat. Jalankan skrip supabase_schema.sql di SQL Editor Supabase.',
          details: { tableMissing: true }
        };
      }
      return { 
        success: true, 
        message: `Terhubung ke Supabase! Respon tabel: ${queryError.message}` 
      };
    }

    return { 
      success: true, 
      message: `Sempurna! Terhubung langsung ke database Supabase (${config.url}) melalui variabel Vercel. Database siap digunakan.` 
    };
  } catch (err: any) {
    return { 
      success: false, 
      message: `Gagal terhubung: ${err?.message || 'Host tidak dapat dijangkau.'}` 
    };
  }
};
