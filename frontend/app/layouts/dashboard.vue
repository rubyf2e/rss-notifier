<script setup lang="ts">
const { session, validation, clearSession } = useNotifierAuth();

async function signOut() {
  clearSession();
  await navigateTo("/login", { replace: true });
}
</script>

<template>
  <div v-if="validation === 'valid'" class="app-shell">
    <header class="app-header">
      <div class="flex items-center gap-7">
        <NuxtLink
          class="brand-lockup"
          to="/subscriptions"
          aria-label="RSS Notifier 首頁"
        >
          <span class="brand-mark">R</span>
          <span>RSS NOTIFIER</span>
        </NuxtLink>
        <nav class="app-header-nav" aria-label="主要導覽">
          <NuxtLink to="/subscriptions">訂閱管理</NuxtLink>
        </nav>
      </div>
      <div class="app-header-account">
        <span class="account-email">{{ session?.user.email }}</span>
        <el-button text @click="signOut">登出</el-button>
      </div>
    </header>
    <slot />
  </div>
  <main
    v-else
    class="grid min-h-screen place-items-center text-sm text-gray-500"
  >
    正在驗證登入狀態…
  </main>
</template>
