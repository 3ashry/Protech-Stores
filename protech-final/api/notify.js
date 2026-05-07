export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { customerName, total, orderCode } = req.body;
  
  try {
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Key os_v2_app_77p5trhqrfgyjm4kc64gtuha5j64fi6bbmougwm4ubdbxxnoxqdpa6tlva53wfzwkestkao5eof6tiqveqyu6ds4khiy7ufd2ni3voi'
      },
      body: JSON.stringify({
        app_id: 'ffdfd9c4-f089-4d84-b38a-17b869d0e0ea',
        included_segments: ['Total Subscriptions'],
        headings: { en: '🛒 New Order — Protech' },
        contents: { en: `New order from ${customerName} — EGP ${total} — #${orderCode}` },
        url: 'https://protech-stores.vercel.app',
        chrome_web_icon: 'https://protech-stores.vercel.app/favicon.ico',
      })
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
