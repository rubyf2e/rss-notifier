<script setup lang="ts">
definePageMeta({ layout: false });

const route = useRoute();
const api = useNotifierApi();
const auth = useNotifierAuth();
const viewState = ref<"ready" | "working" | "success" | "error">("ready");
const errorMessage = ref("");

const token = computed(() =>
  typeof route.query.token === "string" ? route.query.token : "",
);

async function confirmUnsubscribe() {
  viewState.value = "working";
  errorMessage.value = "";
  try {
    await api.unsubscribe(token.value);
    viewState.value = "success";
  } catch (error) {
    errorMessage.value = api.getErrorMessage(
      error,
      "取消訂閱失敗，請稍後再試。",
    );
    viewState.value = "error";
  }
}

async function returnToApp() {
  await navigateTo(auth.session.value ? "/subscriptions" : "/login");
}
</script>

<template>
  <main class="unsubscribe-shell">
    <section class="unsubscribe-card">
      <NuxtLink class="brand-lockup" to="/login" aria-label="RSS Notifier">
        <span class="brand-mark">R</span>
        <span>RSS NOTIFIER</span>
      </NuxtLink>

      <template v-if="viewState === 'ready'">
        <p class="section-kicker">EMAIL PREFERENCES</p>
        <h1>取消此 Feed 的通知？</h1>
        <p>確認後，這個 Feed 的新文章通知將停止寄送。</p>
        <el-button
          type="primary"
          :loading="viewState === 'working'"
          @click="confirmUnsubscribe"
        >
          確認取消訂閱
        </el-button>
      </template>
      <template v-else-if="viewState === 'working'">
        <h1>正在更新訂閱</h1>
        <p>請稍候…</p>
        <el-skeleton :rows="2" animated />
      </template>
      <template v-else-if="viewState === 'success'">
        <p class="section-kicker">已完成</p>
        <h1>已取消訂閱</h1>
        <p>此 Feed 的通知已停止。</p>
        <el-button class="mt-5" @click="returnToApp">完成</el-button>
      </template>
      <template v-else>
        <p class="section-kicker">無法驗證</p>
        <h1>連結無效</h1>
        <p>{{ errorMessage }}</p>
        <el-alert
          title="請確認使用完整且有效的取消訂閱連結。"
          type="error"
          :closable="false"
          show-icon
        />
        <el-button class="mt-5" @click="returnToApp">返回</el-button>
      </template>
    </section>
  </main>
</template>
