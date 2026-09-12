#!/usr/bin/env bash

set -u

printf '%s\n' '请选择 Key 的来源（脚本只会请求所选区域，不会跨区发送 Key）：'
printf '%s\n' '  1) Kimi Code 会员订阅（中国区，kimi.com）'
printf '%s\n' '  2) Kimi Code 会员订阅（海外区，kimi.ai）'
printf '%s\n' '  3) Kimi 开放平台余额（中国区，platform.kimi.com）'
printf '%s\n' '  4) Kimi API Platform 余额（海外区，platform.kimi.ai）'
printf '输入 1-4: '
IFS= read -r KIMI_TEST_CHOICE

case "$KIMI_TEST_CHOICE" in
  1)
    KIMI_TEST_BASE_URL='https://api.kimi.com/coding/v1'
    KIMI_TEST_USAGE_PATH='/usages'
    KIMI_TEST_MODE='Kimi Code 中国区'
    ;;
  2)
    KIMI_TEST_BASE_URL='https://api.kimi.ai/coding/v1'
    KIMI_TEST_USAGE_PATH='/usages'
    KIMI_TEST_MODE='Kimi Code 海外区'
    ;;
  3)
    KIMI_TEST_BASE_URL='https://api.moonshot.cn/v1'
    KIMI_TEST_USAGE_PATH='/users/me/balance'
    KIMI_TEST_MODE='Kimi 开放平台中国区'
    ;;
  4)
    KIMI_TEST_BASE_URL='https://api.moonshot.ai/v1'
    KIMI_TEST_USAGE_PATH='/users/me/balance'
    KIMI_TEST_MODE='Kimi 开放平台海外区'
    ;;
  *)
    printf '%s\n' '无效选择。' >&2
    exit 2
    ;;
esac

printf '请输入 API Key（输入内容不会显示）: '
IFS= read -r -s KIMI_TEST_KEY
printf '\n'
if [[ -z "$KIMI_TEST_KEY" ]]; then
  printf '%s\n' 'API Key 不能为空。' >&2
  exit 2
fi

KIMI_TEST_TMP_DIR=$(mktemp -d)
KIMI_TEST_RESPONSE_FILE="$KIMI_TEST_TMP_DIR/response.json"
KIMI_TEST_CURL_CONFIG="$KIMI_TEST_TMP_DIR/curl.conf"
umask 077
printf 'header = "Authorization: Bearer %s"\n' "$KIMI_TEST_KEY" >"$KIMI_TEST_CURL_CONFIG"
cleanup() {
  unset KIMI_TEST_KEY
  rm -f -- "$KIMI_TEST_RESPONSE_FILE" "$KIMI_TEST_CURL_CONFIG"
  rmdir -- "$KIMI_TEST_TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

print_response() {
  if [[ ! -s "$KIMI_TEST_RESPONSE_FILE" ]]; then
    printf '%s\n' '(空响应体)'
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    jq . "$KIMI_TEST_RESPONSE_FILE" 2>/dev/null | head -c 12000 ||
      head -c 12000 "$KIMI_TEST_RESPONSE_FILE"
  else
    head -c 12000 "$KIMI_TEST_RESPONSE_FILE"
  fi
  printf '\n'
}

request_endpoint() {
  KIMI_TEST_LABEL=$1
  KIMI_TEST_URL=$2
  printf '\n[%s]\nGET %s\n' "$KIMI_TEST_LABEL" "$KIMI_TEST_URL"
  : >"$KIMI_TEST_RESPONSE_FILE"
  KIMI_TEST_HTTP_STATUS=$(curl -sS \
    --config "$KIMI_TEST_CURL_CONFIG" \
    --proto '=https' \
    --tlsv1.2 \
    --connect-timeout 10 \
    --max-time 30 \
    --max-filesize 1048576 \
    --output "$KIMI_TEST_RESPONSE_FILE" \
    --write-out '%{http_code}' \
    --header 'Accept: application/json' \
    --header 'User-Agent: usage-cat-diagnostic/1.0' \
    "$KIMI_TEST_URL")
  KIMI_TEST_CURL_CODE=$?
  if [[ $KIMI_TEST_CURL_CODE -ne 0 ]]; then
    printf 'curl 失败，退出码：%s\n' "$KIMI_TEST_CURL_CODE"
    KIMI_TEST_HTTP_STATUS='000'
  else
    printf 'HTTP 状态：%s\n' "$KIMI_TEST_HTTP_STATUS"
  fi
  print_response
}

printf '\n正在测试：%s\n' "$KIMI_TEST_MODE"
request_endpoint '验证 Key / 区域' "$KIMI_TEST_BASE_URL/models"
KIMI_TEST_MODEL_STATUS=$KIMI_TEST_HTTP_STATUS
request_endpoint '查询剩余额度' "$KIMI_TEST_BASE_URL$KIMI_TEST_USAGE_PATH"
KIMI_TEST_USAGE_STATUS=$KIMI_TEST_HTTP_STATUS

printf '\n[诊断结论]\n'
if [[ "$KIMI_TEST_MODEL_STATUS" == '200' && "$KIMI_TEST_USAGE_STATUS" == '200' ]]; then
  printf '%s\n' 'Key、产品和区域均正确；usage-cat 应当可以采集。'
elif [[ "$KIMI_TEST_MODEL_STATUS" == '401' || "$KIMI_TEST_MODEL_STATUS" == '403' ]]; then
  printf '%s\n' 'Key 验证失败：通常是产品/区域选错、Key 被撤销，或 Key 已失效。'
elif [[ "$KIMI_TEST_MODEL_STATUS" == '200' ]]; then
  printf 'Key 本身有效，但额度接口返回 HTTP %s；请把两段响应发给我（不要发送 Key）。\n' "$KIMI_TEST_USAGE_STATUS"
elif [[ "$KIMI_TEST_MODEL_STATUS" == '000' || "$KIMI_TEST_USAGE_STATUS" == '000' ]]; then
  printf '%s\n' '存在网络、DNS、TLS、超时或响应过大的问题。'
else
  printf 'Key 验证接口返回 HTTP %s，额度接口返回 HTTP %s；请把两段响应发给我（不要发送 Key）。\n' "$KIMI_TEST_MODEL_STATUS" "$KIMI_TEST_USAGE_STATUS"
fi
