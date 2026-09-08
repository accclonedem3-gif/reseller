export function getUserbotCampaignJobId(campaignId: string, runAtMs: number) {
  return "userbot_campaign_" + campaignId + "_" + runAtMs;
}
