const axios = require('axios');

// قراءة توكن البوت من متغيرات بيئة Vercel
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const MY_API_URL = 'https://videos-api-murex.vercel.app/api';

// ذاكرة مؤقتة لتتبع الفيديوهات المشاهدة لكل مستخدم لمنع التكرار
const userHistory = {};

module.exports = async (req, res) => {
  // استقبال التحديثات من تلغرام حصراً
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server is running!');
  }

  const update = req.body;

  try {
    // التأكد من وجود التوكن
    if (!BOT_TOKEN) {
      console.error('BOT_TOKEN Environment Variable is missing!');
      return res.status(500).send('Bot Token not configured.');
    }

    // 1. التعامل مع الأوامر النصية مثل /start
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === '/start') {
        const welcomeText = 
          `👋 أهلاً بك في بوت عرض الريلز!\n\n` +
          `🎬 **وظيفة البوت:**\n` +
          `يقوم البوت بعرض مقاطع فيديو ريلز عشوائية وبشكل مستمر دون تكرار المقطع حتى تشاهد جميع المقاطع المتاحة.\n\n` +
          `👇 اضغط على زر **"فيديو جديد 🎬"** للبدء!`;

        const keyboard = {
          inline_keyboard: [
            [{ text: '🎬 فيديو جديد', callback_data: 'next_video' }]
          ]
        };

        await sendTelegram('sendMessage', {
          chat_id: chatId,
          text: welcomeText,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
    }

    // 2. التعامل مع الضغط على الأزرار الشفافة (Inline Buttons)
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      const data = callback.data;

      // زر التالي (عرض فيديو عشوائي بدون تكرار)
      if (data === 'next_video') {
        await sendTelegram('answerCallbackQuery', { callback_query_id: callback.id, text: '⏳ جاري جلب الفيديو...' });

        // جلب قائمة الفيديوهات من API الخاص بك
        const apiRes = await axios.get(MY_API_URL);
        const allVideos = apiRes.data.data;

        if (!allVideos || allVideos.length === 0) {
          await sendTelegram('sendMessage', { chat_id: chatId, text: '❌ لا توجد فيديوهات متاحة حالياً.' });
          return res.status(200).send('OK');
        }

        // تهيئة السجل للمستخدم إن لم يكن موجوداً
        if (!userHistory[chatId]) {
          userHistory[chatId] = [];
        }

        // استبعاد الفيديوهات التي شاهدها المستخدم سابقاً
        let unseenVideos = allVideos.filter(v => !userHistory[chatId].includes(v.url));

        // إذا شاهد كل الفيديوهات، نُفرغ السجل ليبدأ من جديد
        if (unseenVideos.length === 0) {
          userHistory[chatId] = [];
          unseenVideos = allVideos;
        }

        // اختيار فيديو عشوائي من الغير مشاهدة
        const selectedVideo = unseenVideos[Math.floor(Math.random() * unseenVideos.length)];
        userHistory[chatId].push(selectedVideo.url); // حفظه في سجل المشاهدة

    
        
        // تحويل رابط إنستغرام إلى رابط MP4 مباشر
        let directUrl = null;
        try {
          const cobaltRes = await axios.post('https://api.cobalt.tools/api/json', {
            url: selectedVideo.url
          }, {
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
          });
          directUrl = cobaltRes.data?.url;
        } catch (e) {
          console.error('Cobalt Error:', e.message);
        }

        // الأزرار الشفافة التفاعلية (تشغيل، إيقاف، التالي)
        const controlButtons = {
          inline_keyboard: [
            [
              { text: '▶️ تشغيل', callback_data: 'play_msg' },
              { text: '⏸️ إيقاف', callback_data: 'pause_msg' }
            ],
            [
              { text: '⏭️ التالي (فيديو آخر)', callback_data: 'next_video' }
            ]
          ]
        };

        if (directUrl) {
          await sendTelegram('sendVideo', {
            chat_id: chatId,
            video: directUrl,
            caption: '🎬 مشاهدة ممتعة!',
            reply_markup: controlButtons
          });
        } else {
          // في حال تعذر تحويل الفيديو، يتم إرسال الرابط مباشرة
          await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `لم نتمكن من تشغيل الفيديو مباشرة، يمكنك مشاهدته من الرابط:\n${selectedVideo.url}`,
            reply_markup: controlButtons
          });
        }
      }

      // أزرار التحكم بالتشغيل والإيقاف
      if (data === 'play_msg') {
        await sendTelegram('answerCallbackQuery', {
          callback_query_id: callback.id,
          text: '▶️ يمكنك تشغيل الفيديو بالضغط عليه في الشاشة.',
          show_alert: false
        });
      }

      if (data === 'pause_msg') {
        await sendTelegram('answerCallbackQuery', {
          callback_query_id: callback.id,
          text: '⏸️ تم إيقاف الفيديو (اضغط على الفيديو للإيقاف المؤقت).',
          show_alert: false
        });
      }
    }

  } catch (error) {
    console.error('Error handling webhook:', error.message);
  }

  res.status(200).send('OK');
};

// دالة مساعدة لإرسال الطلبات إلى تليجرام
async function sendTelegram(method, params) {
  return await axios.post(`${TELEGRAM_API}/${method}`, params);
}
