// Configuração de conexão com o Supabase.
// Supabase > Project Settings > API: copie a "Project URL" e a chave pública "anon" (ou "publishable").
// A chave anon é pública por natureza; a proteção dos dados é feita pelo login + RLS (ver supabase/01_schema.sql).
window.SUPABASE_CONFIG = {
  url: 'https://kaidneqmzjslgrmcibyz.supabase.co',
  anonKey: 'sb_publishable_QGBVTLKmmslMF-LMrYXk7A_OmJY-tS1',
  bucket: 'evidencias',
  // validade (segundos) dos links temporários das fotos do bucket privado
  urlAssinadaSegundos: 3600
};
