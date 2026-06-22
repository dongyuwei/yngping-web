curl http://10.144.209.129:11434/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d '{
          "model": "huihui_ai/hy-mt1.5-abliterated:1.8b",
          "messages": [
            {
              "role": "system",
              "content": "你是一个专业的翻译助手"
            },
            {
              "role": "user",
              "content": "将以下中文翻译成英文：你好，世界！"
            }
          ],
          "temperature": 0.7,
          "stream": false, 
          "keep_alive": "-1"
        }'