import { IsIn } from "class-validator";

export class CreateUpgradePaymentDto {
  @IsIn(["pro"])
  targetTier!: "pro";
}
