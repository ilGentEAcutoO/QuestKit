export interface Campaign {
  id: string;
  title: string;
  description: string;
  startAt: number;
  endAt: number;
  missionIds: string[];
  theme?: CampaignTheme;
  bannerUrl?: string;
}

export interface CampaignTheme {
  primaryColor?: string;
}
