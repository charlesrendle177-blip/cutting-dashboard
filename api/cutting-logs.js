export default async function handler(req, res) {
  const ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4d21mc3NkdnBpbGZ2YnBicnJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDY3NjQsImV4cCI6MjA5MTkyMjc2NH0.mG9jnkxhvcXonICd6BAkjCxNDiJJ_xfcJORQIaQuztw';

  const upstream = await fetch(
    'https://rxwmfssdvpilfvbpbrrq.supabase.co/rest/v1/cutting_logs?select=*&order=date.asc',
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
  );

  const data = await upstream.json();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.status(upstream.status).json(data);
}
