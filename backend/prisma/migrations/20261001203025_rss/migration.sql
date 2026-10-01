-- CreateTable
CREATE TABLE "feeds" (
    "id" BIGSERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "site_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'HEALTHY',
    "initial_sync_completed" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" BIGSERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "feed_id" BIGINT NOT NULL,
    "guid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "description" TEXT,
    "published_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" BIGSERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "feed_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "unsubscribe_token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_status_history" (
    "id" BIGSERIAL NOT NULL,
    "subscription_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" BIGSERIAL NOT NULL,
    "subscription_id" BIGINT NOT NULL,
    "article_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feeds_public_id_key" ON "feeds"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "feeds_url_key" ON "feeds"("url");

-- CreateIndex
CREATE INDEX "feeds_status_idx" ON "feeds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "articles_public_id_key" ON "articles"("public_id");

-- CreateIndex
CREATE INDEX "articles_feed_id_first_seen_at_idx" ON "articles"("feed_id", "first_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "articles_feed_id_guid_key" ON "articles"("feed_id", "guid");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_public_id_key" ON "subscriptions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_unsubscribe_token_hash_key" ON "subscriptions"("unsubscribe_token_hash");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_feed_id_idx" ON "subscriptions"("feed_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_feed_id_key" ON "subscriptions"("user_id", "feed_id");

-- CreateIndex
CREATE INDEX "subscription_status_history_subscription_id_created_at_idx" ON "subscription_status_history"("subscription_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_status_next_retry_at_idx" ON "notification_logs"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "notification_logs_subscription_id_idx" ON "notification_logs"("subscription_id");

-- CreateIndex
CREATE INDEX "notification_logs_article_id_idx" ON "notification_logs"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_subscription_id_article_id_key" ON "notification_logs"("subscription_id", "article_id");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_status_history" ADD CONSTRAINT "subscription_status_history_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
