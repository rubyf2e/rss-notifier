<script setup lang="ts">
import type { UnsubscribePreview } from "~/types/notifier";

definePageMeta({ layout: false });

const route = useRoute();
const api = useNotifierApi();
const { session } = useDemoAuth();
const viewState = ref<"loading" | "ready" | "working" | "success" | "error">(
  "loading",
);
const preview = ref<UnsubscribePreview | null>(null);
const errorMessage = ref("");

const token = computed(() =>
  typeof route.query.token === "string" ? route.query.token : "",
);

async function loadPreview() {
  viewState.value = "loading";
  errorMessage.value = "";
  try {
    preview.value = await api.getUnsubscribePreview(token.value);
    viewState.value = "ready";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "取消訂閱連結無效。";
    viewState.value = "error";
  }
}

async function confirmUnsubscribe() {
  viewState.value = "working";
  errorMessage.value = "";
  try {
    preview.value = await api.unsubscribe(token.value);
    viewState.value = "success";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "取消訂閱失敗，請稍後再試。";
    viewState.value = "error";
  }
}

async function returnToApp() {
  await navigateTo(session.value ? "/subscriptions" : "/login");
}

onMounted(loadPreview);
</script>

<template>
  <main class="unsubscribe-shell">
    <section class="unsubscribe-card">
      <NuxtLink class="brand-lockup" to="/login" aria-label="RSS Notifier">
        <span class="brand-mark">R</span>
        <span>RSS NOTIFIER</span>
      </NuxtLink>

      <template v-if="viewState === 'loading'">
        <h1>確認取消訂閱</h1>
        <p>正在驗證連結…</p>
        <el-skeleton :rows="2" animated />
      </template>
      <template v-else-if="viewState === 'ready'">
        <p class="section-kicker">EMAIL PREFERENCES</p>
        <h1>取消 {{ preview?.feedName }} 通知？</h1>
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
        <p>{{ preview?.feedName }} 的通知已停止。</p>
        <el-alert
          title="此示範只更新本機 mock 資料。"
          type="success"
          :closable="false"
          show-icon
        />
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
