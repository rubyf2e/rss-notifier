<script setup lang="ts">
definePageMeta({ layout: false });

const route = useRoute();
const api = useNotifierApi();
const auth = useNotifierAuth();
const errorMessage = ref("");

onMounted(async () => {
  const token = typeof route.query.token === "string" ? route.query.token : "";
  try {
    const response = await api.verifyMagicLink(token);
    auth.setSession(response);
    await navigateTo("/subscriptions", { replace: true });
  } catch (error) {
    errorMessage.value = api.getErrorMessage(error, "登入連結驗證失敗，請重新申請。");
  }
});
</script>

<template>
  <main class="unsubscribe-shell">
    <section class="unsubscribe-card">
      <NuxtLink class="brand-lockup" to="/login" aria-label="RSS Notifier">
        <span class="brand-mark">R</span>
        <span>RSS NOTIFIER</span>
      </NuxtLink>
      <template v-if="!errorMessage">
        <h1>正在驗證登入連結</h1>
        <p>驗證成功後會自動前往訂閱管理。</p>
        <el-skeleton :rows="2" animated />
      </template>
      <template v-else>
        <p class="section-kicker">無法登入</p>
        <h1>登入連結無效</h1>
        <p>{{ errorMessage }}</p>
        <el-button type="primary" @click="navigateTo('/login')">返回登入</el-button>
      </template>
    </section>
  </main>
</template>