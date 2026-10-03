<script setup lang="ts">
import type { FormInstance, FormRules } from "element-plus";

definePageMeta({ layout: false });

const api = useNotifierApi();
const formRef = ref<FormInstance>();
const email = ref("");
const isSending = ref(false);
const requestSent = ref(false);
const responseMessage = ref("");
const errorMessage = ref("");

const rules: FormRules = {
  email: [
    { required: true, message: "請輸入 Email。", trigger: "blur" },
    {
      type: "email",
      message: "請輸入有效的 Email 地址。",
      trigger: ["blur", "change"],
    },
  ],
};

async function requestLink() {
  errorMessage.value = "";
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  isSending.value = true;
  try {
    const response = await api.requestMagicLink(email.value.trim());
    responseMessage.value = response.message;
    requestSent.value = true;
  } catch (error) {
    errorMessage.value = api.getErrorMessage(
      error,
      "登入連結申請失敗，請稍後再試。",
    );
  } finally {
    isSending.value = false;
  }
}
</script>

<template>
  <main class="login-shell">
    <aside class="login-aside">
      <NuxtLink class="brand-lockup" to="/login" aria-label="RSS Notifier">
        <span class="brand-mark">R</span>
        <span>RSS NOTIFIER</span>
      </NuxtLink>
      <div class="login-aside-copy">
        <p class="login-kicker">Your feeds, in good order</p>
        <h1>新文章，不再錯過。</h1>
        <p>集中管理 RSS 訂閱，只在有新消息時收到通知。</p>
      </div>
      <div class="login-aside-foot">RSS NOTIFIER · FEED MONITOR</div>
    </aside>

    <section class="login-main">
      <div class="login-card">
        <template v-if="!requestSent">
          <p class="section-kicker">電子郵件登入</p>
          <h2>歡迎回來</h2>
          <p class="login-card-intro">輸入 Email，我們會寄送一次性登入連結。</p>

          <el-form
            ref="formRef"
            :model="{ email }"
            :rules="rules"
            label-position="top"
            @submit.prevent="requestLink"
          >
            <el-form-item label="Email" prop="email">
              <el-input
                v-model="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                maxlength="254"
                size="large"
                :disabled="isSending"
              />
            </el-form-item>
            <el-alert
              v-if="errorMessage"
              class="mb-4"
              :title="errorMessage"
              type="error"
              :closable="false"
            />
            <el-button
              type="primary"
              native-type="submit"
              class="w-full"
              :loading="isSending"
            >
              寄送登入連結
            </el-button>
          </el-form>
          <p class="login-hint">登入連結將寄送至你提供的 Email。</p>
        </template>

        <template v-else>
          <p class="section-kicker">申請完成</p>
          <h2>檢查你的信箱</h2>
          <p class="login-card-intro">
            {{ responseMessage }}
          </p>
          <el-alert
            :title="responseMessage"
            type="success"
            :closable="false"
            show-icon
          />
          <el-button class="mt-3 w-full" @click="requestSent = false"
            >使用其他 Email</el-button
          >
        </template>
      </div>
    </section>
  </main>
</template>
