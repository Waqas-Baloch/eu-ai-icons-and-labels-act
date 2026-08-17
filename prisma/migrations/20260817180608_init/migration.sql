-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "domain" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "plan" TEXT NOT NULL DEFAULT 'none',
    "subscriptionId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "disclaimerAcceptedAt" TIMESTAMP(3),
    "disclaimerAcceptedBy" TEXT,
    "termsVersion" TEXT,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "onboardingCompletedAt" TIMESTAMP(3),
    "themeActivatedAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "Settings" (
    "shopDomain" TEXT NOT NULL,
    "badgeVariant" TEXT NOT NULL DEFAULT 'black',
    "badgePlacement" TEXT NOT NULL DEFAULT 'bottom_left',
    "badgeSize" TEXT NOT NULL DEFAULT 'medium',
    "showTextNotice" BOOLEAN NOT NULL DEFAULT true,
    "noticeText" TEXT NOT NULL DEFAULT 'This image was created or edited using artificial intelligence.',
    "conservativeDefault" BOOLEAN NOT NULL DEFAULT true,
    "labelPreCutoffContent" BOOLEAN NOT NULL DEFAULT false,
    "euOnlyRendering" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("shopDomain")
);

-- CreateTable
CREATE TABLE "ProductAssessment" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "disclosureState" TEXT NOT NULL DEFAULT 'unknown',
    "labelVariant" TEXT NOT NULL DEFAULT 'none',
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "lastAssessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageAssessment" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "productAssessmentId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "altText" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT,
    "provenanceSource" TEXT NOT NULL DEFAULT 'none',
    "detectedOrigin" TEXT NOT NULL DEFAULT 'unknown',
    "generatorName" TEXT,
    "contentCreatedAt" TIMESTAMP(3),
    "provenanceRaw" TEXT,
    "declaredOrigin" TEXT,
    "declaredRealism" TEXT,
    "declaredContext" TEXT,
    "declaredNote" TEXT,
    "declaredAt" TIMESTAMP(3),
    "declaredBy" TEXT,
    "disclosureState" TEXT NOT NULL DEFAULT 'unknown',
    "labelVariant" TEXT NOT NULL DEFAULT 'none',
    "reasoning" TEXT NOT NULL DEFAULT '[]',
    "engineVersion" TEXT NOT NULL DEFAULT '0.0.0',
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "badgeCorner" TEXT,
    "badgeStyle" TEXT,
    "badgeX" DOUBLE PRECISION,
    "badgeY" DOUBLE PRECISION,
    "badgeHeightPct" DOUBLE PRECISION,
    "labelOverride" TEXT,
    "labelOverrideBy" TEXT,
    "labelOverrideAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "subject" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "productsSeen" INTEGER NOT NULL DEFAULT 0,
    "imagesSeen" INTEGER NOT NULL DEFAULT 0,
    "imagesFlagged" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductAssessment_shopDomain_needsReview_idx" ON "ProductAssessment"("shopDomain", "needsReview");

-- CreateIndex
CREATE INDEX "ProductAssessment_shopDomain_disclosureState_idx" ON "ProductAssessment"("shopDomain", "disclosureState");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAssessment_shopDomain_productId_key" ON "ProductAssessment"("shopDomain", "productId");

-- CreateIndex
CREATE INDEX "ImageAssessment_shopDomain_disclosureState_idx" ON "ImageAssessment"("shopDomain", "disclosureState");

-- CreateIndex
CREATE INDEX "ImageAssessment_shopDomain_contentHash_idx" ON "ImageAssessment"("shopDomain", "contentHash");

-- CreateIndex
CREATE INDEX "ImageAssessment_productAssessmentId_position_idx" ON "ImageAssessment"("productAssessmentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ImageAssessment_shopDomain_imageId_key" ON "ImageAssessment"("shopDomain", "imageId");

-- CreateIndex
CREATE INDEX "AuditEntry_shopDomain_createdAt_idx" ON "AuditEntry"("shopDomain", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEntry_shopDomain_subject_idx" ON "AuditEntry"("shopDomain", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEntry_shopDomain_seq_key" ON "AuditEntry"("shopDomain", "seq");

-- CreateIndex
CREATE INDEX "ScanRun_shopDomain_startedAt_idx" ON "ScanRun"("shopDomain", "startedAt");

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAssessment" ADD CONSTRAINT "ProductAssessment_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAssessment" ADD CONSTRAINT "ImageAssessment_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAssessment" ADD CONSTRAINT "ImageAssessment_productAssessmentId_fkey" FOREIGN KEY ("productAssessmentId") REFERENCES "ProductAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;
