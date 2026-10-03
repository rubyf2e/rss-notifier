<script setup lang="ts">
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from "element-plus";
import type { SubscriptionResponse } from "~/types/notifier";

definePageMeta({
  layout: "dashboard",
  middleware: "auth",
});

const api = useNotifierApi();
const subscriptions = ref<SubscriptionResponse[]>([]);
const isLoading = ref(true);
const listError = ref("");
const isAdding = ref(false);
const feedUrl = ref("");
const addError = ref("");
const addForm = ref<FormInstance>();
const busySubscriptionId = ref<string | null>(null);

const feedRules: FormRules = {
  url: [
    { required: true, message: "請輸入 RSS 或 Atom 網址。", trigger: "blur" },
    { type: "url", message: "請輸入有效的網址。", trigger: ["blur", "change"] },
  ],
};

const activeCount = computed(
  () => subscriptions.value.filter((item) => item.status === "ACTIVE").length,
);
const attentionCount = computed(
  () =>
    subscriptions.value.filter((item) => item.feed.status === "ERROR").length,
);

async function loadSubscriptions() {
  isLoading.value = true;
  listError.value = "";
  try {
    subscriptions.value = await api.listSubscriptions();
  } catch (error) {
    listError.value =
      error instanceof Error ? error.message : "訂閱清單載入失敗。";
  } finally {
    isLoading.value = false;
  }
}

async function addFeed() {
  addError.value = "";
  try {
    await addForm.value?.validate();
  } catch {
    return;
  }

  isAdding.value = true;
  try {
    await api.createSubscription(feedUrl.value.trim());
    feedUrl.value = "";
    await loadSubscriptions();
    ElMessage.success("Feed 已加入訂閱清單。");
  } catch (error) {
    addError.value =
      error instanceof Error ? error.message : "新增 Feed 失敗，請稍後再試。";
  } finally {
    isAdding.value = false;
  }
}

async function toggleSubscription(subscription: SubscriptionResponse) {
  busySubscriptionId.value = subscription.publicId;
  const nextStatus = subscription.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  try {
    await api.updateSubscriptionStatus(subscription.publicId, nextStatus);
    await loadSubscriptions();
    ElMessage.success(
      nextStatus === "PAUSED" ? "已暫停此訂閱。" : "已恢復此訂閱。",
    );
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : "更新訂閱狀態失敗。",
    );
  } finally {
    busySubscriptionId.value = null;
  }
}

async function removeSubscription(subscription: SubscriptionResponse) {
  try {
    await ElMessageBox.confirm(
      `確定刪除「${subscription.feed.title}」？刪除後將停止此 Feed 的通知。`,
      "刪除訂閱",
      {
        confirmButtonText: "刪除訂閱",
        cancelButtonText: "保留",
        confirmButtonClass: "el-button--danger",
        type: "warning",
      },
    );
  } catch {
    return;
  }

  busySubscriptionId.value = subscription.publicId;
  try {
    await api.deleteSubscription(subscription.publicId);
    await loadSubscriptions();
    ElMessage.success("訂閱已刪除。");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "刪除訂閱失敗。");
  } finally {
    busySubscriptionId.value = null;
  }
}

function formatDate(value: string | null) {
  if (!value) return "尚無成功同步";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

onMounted(loadSubscriptions);
</script>

<template>
  <main class="dashboard-main">
    <div class="dashboard-heading">
      <div>
        <p class="section-kicker">FEED OVERVIEW</p>
        <h1 class="page-title">訂閱管理</h1>
        <p class="page-description">追蹤 Feed 狀態，管理你想收到的更新。</p>
      </div>
      <span class="text-xs text-gray-500">示範資料 · 僅儲存在目前工作階段</span>
    </div>

    <section class="overview-grid" aria-label="訂閱摘要">
      <div class="overview-item">
        <span class="overview-label">訂閱總數</span>
        <strong class="overview-value">{{ subscriptions.length }}</strong>
      </div>
      <div class="overview-item">
        <span class="overview-label">通知啟用中</span>
        <strong class="overview-value">{{ activeCount }}</strong>
      </div>
      <div class="overview-item">
        <span class="overview-label">需要留意</span>
        <strong class="overview-value">{{ attentionCount }}</strong>
      </div>
    </section>

    <section class="content-section" aria-labelledby="add-feed-heading">
      <div class="section-header">
        <div>
          <h2 id="add-feed-heading">新增 Feed</h2>
          <p>貼上 RSS 或 Atom 網址。</p>
        </div>
      </div>
      <el-form
        ref="addForm"
        class="feed-form"
        :model="{ url: feedUrl }"
        :rules="feedRules"
        @submit.prevent="addFeed"
      >
        <el-form-item prop="url">
          <el-input
            v-model="feedUrl"
            type="url"
            placeholder="https://example.com/feed.xml"
            aria-label="RSS 或 Atom 網址"
            :disabled="isAdding"
          />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="isAdding"
          >新增訂閱</el-button
        >
        <el-alert
          v-if="addError"
          class="col-span-full"
          :title="addError"
          type="error"
          :closable="false"
          show-icon
        />
      </el-form>
    </section>

    <section
      class="content-section"
      aria-labelledby="subscription-list-heading"
    >
      <div class="section-header">
        <div>
          <h2 id="subscription-list-heading">你的訂閱</h2>
          <p>Feed 健康狀態與通知狀態分開顯示。</p>
        </div>
        <el-button text :loading="isLoading" @click="loadSubscriptions"
          >重新整理</el-button
        >
      </div>

      <div v-if="isLoading" class="empty-state">
        <el-skeleton :rows="4" animated />
      </div>
      <div v-else-if="listError" class="list-error">
        <el-alert :title="listError" type="error" :closable="false" show-icon />
        <el-button @click="loadSubscriptions">重新載入</el-button>
      </div>
      <div v-else-if="subscriptions.length === 0" class="empty-state">
        <el-empty description="還沒有訂閱 Feed" />
      </div>
      <div v-else class="subscription-list">
        <article
          v-for="subscription in subscriptions"
          :key="subscription.publicId"
          class="subscription-row"
        >
          <div>
            <h3 class="feed-name">{{ subscription.feed.title }}</h3>
            <span class="feed-url">{{ subscription.feed.url }}</span>
          </div>

          <div>
            <span class="feed-meta-label">狀態</span>
            <div class="status-stack">
              <span
                class="status-chip"
                :class="
                  subscription.status === 'PAUSED'
                    ? 'status-chip--paused'
                    : 'status-chip--healthy'
                "
              >
                {{
                  subscription.status === "PAUSED" ? "通知已暫停" : "通知啟用中"
                }}
              </span>
              <span
                class="status-chip"
                :class="
                  subscription.feed.status === 'ERROR'
                    ? 'status-chip--error'
                    : 'status-chip--healthy'
                "
              >
                {{
                  subscription.feed.status === "ERROR"
                    ? "Feed 異常"
                    : "Feed 正常"
                }}
              </span>
            </div>
          </div>

          <div>
            <span class="feed-meta-label">最近成功同步</span>
            <span class="feed-meta-value">{{
              formatDate(subscription.feed.lastSyncedAt)
            }}</span>
            <span
              v-if="subscription.feed.lastError"
              class="feed-url text-red-700"
            >
              最近錯誤：{{ subscription.feed.lastError }}
            </span>
          </div>

          <div class="row-actions">
            <el-button
              text
              :loading="busySubscriptionId === subscription.publicId"
              :disabled="
                Boolean(
                  busySubscriptionId &&
                  busySubscriptionId !== subscription.publicId,
                )
              "
              @click="toggleSubscription(subscription)"
            >
              {{ subscription.status === "ACTIVE" ? "暫停" : "恢復" }}
            </el-button>
            <el-button
              text
              type="danger"
              :loading="busySubscriptionId === subscription.publicId"
              :disabled="Boolean(busySubscriptionId)"
              @click="removeSubscription(subscription)"
            >
              刪除
            </el-button>
          </div>
        </article>
      </div>
    </section>

    <p class="page-footer-note">
      UI 示範使用本機 mock；訂閱變更不會呼叫後端或寄送通知。
    </p>
  </main>
</template>
