import 'dotenv/config';

const EMAIL    = 'macarthur1123@gmail.com';
const PASSWORD = 'wargame123';

async function run() {
  // Try raw fetch to GoTrue admin API, bypassing the Supabase JS client
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });

  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Body:', text);
}

run();
