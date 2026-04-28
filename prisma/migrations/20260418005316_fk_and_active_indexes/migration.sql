-- CreateIndex
CREATE INDEX "Addon_isActive_idx" ON "Addon"("isActive");

-- CreateIndex
CREATE INDEX "Addon_depotId_idx" ON "Addon"("depotId");

-- CreateIndex
CREATE INDEX "BondLedger_customerId_idx" ON "BondLedger"("customerId");

-- CreateIndex
CREATE INDEX "BondLedger_status_idx" ON "BondLedger"("status");

-- CreateIndex
CREATE INDEX "BookingAddon_bookingId_idx" ON "BookingAddon"("bookingId");

-- CreateIndex
CREATE INDEX "BookingAddon_addonId_idx" ON "BookingAddon"("addonId");

-- CreateIndex
CREATE INDEX "BookingInsurance_bookingId_idx" ON "BookingInsurance"("bookingId");

-- CreateIndex
CREATE INDEX "BookingInsurance_insuranceOptionId_idx" ON "BookingInsurance"("insuranceOptionId");

-- CreateIndex
CREATE INDEX "BookingNote_bookingId_idx" ON "BookingNote"("bookingId");

-- CreateIndex
CREATE INDEX "BookingNote_userId_idx" ON "BookingNote"("userId");

-- CreateIndex
CREATE INDEX "BookingStatusLog_bookingId_idx" ON "BookingStatusLog"("bookingId");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CustomerProfile_riskRating_idx" ON "CustomerProfile"("riskRating");

-- CreateIndex
CREATE INDEX "Depot_isActive_idx" ON "Depot"("isActive");

-- CreateIndex
CREATE INDEX "Discount_isActive_idx" ON "Discount"("isActive");

-- CreateIndex
CREATE INDEX "IncidentDocument_incidentId_idx" ON "IncidentDocument"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentNote_incidentId_idx" ON "IncidentNote"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentNote_userId_idx" ON "IncidentNote"("userId");

-- CreateIndex
CREATE INDEX "IncidentPhoto_incidentId_idx" ON "IncidentPhoto"("incidentId");

-- CreateIndex
CREATE INDEX "InspectionItem_inspectionId_idx" ON "InspectionItem"("inspectionId");

-- CreateIndex
CREATE INDEX "InspectionPhoto_inspectionId_idx" ON "InspectionPhoto"("inspectionId");

-- CreateIndex
CREATE INDEX "InsuranceOption_isActive_idx" ON "InsuranceOption"("isActive");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_bookingId_idx" ON "Invoice"("bookingId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "MaintenanceLog_workOrderId_idx" ON "MaintenanceLog"("workOrderId");

-- CreateIndex
CREATE INDEX "MaintenancePart_workOrderId_idx" ON "MaintenancePart"("workOrderId");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_vehicleId_idx" ON "MaintenanceSchedule"("vehicleId");

-- CreateIndex
CREATE INDEX "Package_categoryId_idx" ON "Package"("categoryId");

-- CreateIndex
CREATE INDEX "Package_isActive_idx" ON "Package"("isActive");

-- CreateIndex
CREATE INDEX "PricingRule_categoryId_idx" ON "PricingRule"("categoryId");

-- CreateIndex
CREATE INDEX "PricingRule_seasonId_idx" ON "PricingRule"("seasonId");

-- CreateIndex
CREATE INDEX "PricingRule_isActive_idx" ON "PricingRule"("isActive");

-- CreateIndex
CREATE INDEX "SupportTicketNote_ticketId_idx" ON "SupportTicketNote"("ticketId");

-- CreateIndex
CREATE INDEX "SupportTicketNote_userId_idx" ON "SupportTicketNote"("userId");

-- CreateIndex
CREATE INDEX "VehicleCategory_isActive_idx" ON "VehicleCategory"("isActive");

-- CreateIndex
CREATE INDEX "VehicleDocument_vehicleId_idx" ON "VehicleDocument"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleImage_vehicleId_idx" ON "VehicleImage"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleStatusLog_vehicleId_idx" ON "VehicleStatusLog"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleTransfer_vehicleId_idx" ON "VehicleTransfer"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleTransfer_fromDepotId_idx" ON "VehicleTransfer"("fromDepotId");

-- CreateIndex
CREATE INDEX "VehicleTransfer_toDepotId_idx" ON "VehicleTransfer"("toDepotId");

-- CreateIndex
CREATE INDEX "VehicleTransfer_status_idx" ON "VehicleTransfer"("status");

