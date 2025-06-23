import time
import requests
import telebot
from flask import Flask, request

BOT_TOKEN = 'token'
bot = telebot.TeleBot(BOT_TOKEN)
app = Flask(__name__)

@bot.message_handler(commands=["start"])
def start_command(message):
    args = message.text.split()
    if len(args) > 1:
        link_token = args[1]
        telegram_id = message.from_user.id

        # Отправляем токен и telegram_id на node.js сервер
        try:
            requests.post("http://localhost:3000/api/link_telegram", json={
                "token": link_token,
                "telegram_id": telegram_id
            })
            bot.send_message(telegram_id, "✅ Telegram привязан к вашему аккаунту!")
        except Exception as e:
            bot.send_message(telegram_id, f"❌ Ошибка при привязке: {e}")
    else:
        bot.send_message(message.chat.id, "❗ Приходите по кнопке с сайта.")

if __name__ == "__main__":
    while True:
        try:
            bot.infinity_polling(timeout=60, long_polling_timeout=30, interval=2)
        except Exception as e:
            print(f"⚠️ {e}")
            time.sleep(5)
