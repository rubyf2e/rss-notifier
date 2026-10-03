<script setup lang="ts">
const { session, endDemoSession } = useDemoAuth();

async function signOut() {
  endDemoSession();
  await navigateTo("/login");
}
</script>

<template>
  <div class="app-shell">
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
        <span class="account-email">{{ session?.email }}</span>
        <el-button text @click="signOut">登出</el-button>
      </div>
    </header>
    <slot />
  </div>
</template>
