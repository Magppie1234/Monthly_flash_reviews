# Zoho CRM Automation Inventory

Generated: 2026-08-29T18:08:21.123Z

External communication actions remain disabled in the localhost target until a sandbox destination and separate approval are provided.

Workflow action-definition references reconciled: 47/48. Missing definitions remain blocked and are never inferred.

Exact custom-function bodies captured privately and hash-verified: 60/60. Source code and embedded credentials are never published in this inventory.

`Mark Visit Done` has a hash-verified function body and a reviewed semantic candidate, but the captured workflow action exposes no authoritative mapping from its function arguments to CRM fields. It therefore remains blocked with `FUNCTION_PARAMETER_BINDING_UNVERIFIED`; it is not counted as a plan-eligible adapter and no Visit mutation is exposed.

## Current local planning boundary

The reconciled runtime contains 44 detailed rules: 39 active, 4 plan-eligible, and 35 blocked active. The four plan-eligible rules are Contacts `set lead qualified date` (`1032257000004081038`), Deals `updateFormFilledDate` (`1032257000013277102`), Contacts `Update Expected Closing Date Change Counter` (`1032257000016568154`), and Contacts `Set Last Services Date` (`1032257000022813289`). Planning is deterministic and fail-closed; runtime write-enabled rules remain 0.

Two function definitions are reviewed. Only the expected-closing counter has one eligible plan adapter; null initializes to zero in tested planning semantics, while atomic concurrent writes remain blocked. `Mark Visit Done` remains blocked because its body/hash review does not establish authoritative parameter-to-field binding. Captured functions, field updates, webhooks, assignment, email, task, Blueprint, and other source execution paths remain disabled.

| Type | Module | Name | Active | Trigger/Source | Source Coverage | Local Coverage |
| --- | --- | --- | --- | --- | --- | --- |
| Workflow Rule | Deals | Big Deal Rule | No | create_or_edit; actions: email_notifications | Specified | Blocked |
| Workflow Rule | Leads | Lead Distribution Rule | No | create; actions: tasks, assign_owner | Specified | Blocked |
| Workflow Rule | Calls | Automatic Lead Creation | Yes | anyaction; actions: functions | Specified | Blocked |
| Workflow Rule | Contacts | PSM assign | Yes | create; actions: field_updates | Specified | Blocked |
| Workflow Rule | Emails | Notify When opened | Yes | mail_sent_opened; actions: cliq_notifications | Specified | Blocked |
| Workflow Rule | Tasks | Task Creation on Follow Up Date | No | create; actions: tasks | Specified | Blocked |
| Workflow Rule | Visit_Module | Mark Visit Done | Yes | field_update; actions: functions | Specified | Blocked — function parameter binding unavailable |
| Workflow Rule | Contacts | set lead qualified date | Yes | create; actions: field_updates | Specified | Plan eligible; writes blocked |
| Workflow Rule | Calls | create ticket in services management | Yes | incoming_call_start; actions: functions, field_updates | Specified | Blocked |
| Workflow Rule | Deals | UpdateDesignerName | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Contacts | Set PSM User | Yes | create; actions: functions | Specified | Blocked |
| Workflow Rule | Deals | Sync Order Value with Opp | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Leads | set lead creation time - test | Yes | create; actions: field_updates | Specified | Blocked |
| Workflow Rule | Contacts | Create Note In Opportunity | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Deals | updateFormFilledDate | Yes | field_update; actions: field_updates | Specified | Plan eligible; writes blocked |
| Workflow Rule | Calls | Call Durations Update In Mint | Yes | anyaction; actions: functions | Specified | Blocked |
| Workflow Rule | Contacts | Update Note In Opportunity | Yes | create_or_edit; actions: functions | Specified | Blocked |
| Workflow Rule | Deals | Update Total Revision | No | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Contacts | Set Owner Team on Creation - opp | Yes | create; actions: field_updates | Specified | Blocked |
| Workflow Rule | Leads | Lead Distribution - Adglobal | No | create; actions: assign_owner | Specified | Blocked |
| Workflow Rule | Contacts | Set Team on Owner Change - opp | Yes | field_update; actions: field_updates | Specified | Blocked |
| Workflow Rule | Leads | Priya AI - Edit Lead Sync | Yes | field_update; actions: webhooks | Specified | Blocked |
| Workflow Rule | Contacts | fetch old  note | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Leads | Create Note From Description | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Contacts | Create Account | Yes | create; actions: functions | Specified | Blocked |
| Workflow Rule | Leads | Update Last Note In Lead | Yes | create_or_edit; actions: functions | Specified | Blocked |
| Workflow Rule | Contacts | Update Accounts | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Leads | Set Lead Owner Team on Creation | Yes | create; actions: field_updates | Specified | Blocked |
| Workflow Rule | Leads | Set Team On Owner Change | Yes | field_update; actions: field_updates | Specified | Blocked |
| Workflow Rule | Contacts | Copy of Create And Update Order | Yes | create_or_edit; actions: functions | Specified | Blocked |
| Workflow Rule | Leads | Priya AI - New Lead Sync | Yes | create; actions: webhooks | Specified | Blocked |
| Workflow Rule | Contacts | Update Expected Closing Date Change Counter | Yes | field_update; actions: functions | Specified | Plan eligible through reviewed adapter; writes blocked |
| Workflow Rule | Leads | Add Lead Transfer Info | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Contacts | Sync Attachment | Yes | rollup_summary_update; actions: functions | Specified | Blocked |
| Workflow Rule | Leads | Modify Add Country Code And Remove Duplicate Lead | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Contacts | Is Sunrooof | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Leads | Creation Add Country Code And Remove Duplicate Lead | Yes | create; actions: functions | Specified | Blocked |
| Workflow Rule | Leads | New Lead Distribution Rule | Yes | create; actions: tasks, assign_owner | Specified | Blocked |
| Workflow Rule | Contacts | Set Last Services Date | Yes | field_update; actions: field_updates | Specified | Plan eligible; writes blocked |
| Workflow Rule | Leads | test | Yes | field_update; actions: webhooks | Specified | Blocked |
| Workflow Rule | Contacts | test_opp | Yes | field_update; actions: webhooks | Specified | Blocked |
| Workflow Rule | Leads | new_lead_msgtest | Yes | field_update; actions: webhooks | Specified | Blocked |
| Workflow Rule | Contacts | Add Sunrooof files in the workdrive folder | Yes | field_update; actions: functions | Specified | Blocked |
| Workflow Rule | Contacts | Transfer the Qualified Lead | Yes | create; actions: assign_owner | Specified | Blocked |
| Field Update Action | AMS_Complaints | Set complaint Closed Date | No | Complaint_Closed_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Deals | Second Actual Installation End Date | Yes | Second_Install_Actual_End_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Deals | Set First Service Date | Yes | First_Service_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | AMS_Complaints | Set AMS Completed Date | Yes | AMS_Completed_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Visit_Module | Set Visit Done Date | Yes | Completion_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | AMS_Complaints | Set Status QA Done | Yes | Status = QA Done | Specified | Blocked |
| Field Update Action | AMS_Complaints | Set Actual Delivery Date | Yes | Actual_Delivery_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | AMS_Complaints | Srt Status completed | Yes | Status = Completed | Specified | Blocked |
| Field Update Action | AMS_Complaints | Set Status Hold | Yes | Status = Hold | Specified | Blocked |
| Field Update Action | AMS_Complaints | Set QC Date | Yes | QC_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | AMS_Complaints | Set Status In-process | Yes | Status = In Process | Specified | Blocked |
| Field Update Action | Visit_Module | Set QC Date | No | Received_by_Quality = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Deals | Handover to Factory | No | Handover_to_Factory = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Visit_Module | Hold | No | Status = Hold | Specified | Blocked |
| Field Update Action | Visit_Module | Final QA | No | Status = QA Done | Specified | Blocked |
| Field Update Action | Visit_Module | completed | No | Status = Completed | Specified | Blocked |
| Field Update Action | Visit_Module | In Process | No | Status = In Process | Specified | Blocked |
| Field Update Action | Visit_Module | Set Visit Date | No | Activity_Date = ${Visit Module.Scheduled AMS Date} | Inspected | Blocked |
| Field Update Action | Visit_Module | Actual Visit Done Date | No | Actual_Visit_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Contacts | Set Last Services Date | No | Last_Service_Date = ${Visit Module.Visit Date} | Inspected | Blocked |
| Field Update Action | Contacts | Set Next Services Date | Yes | Next_Service_Date = ${Qualified Leads.First Service Date} | Inspected | Blocked |
| Field Update Action | Contacts | Set Last Services Date | Yes | Last_Service_Date = ${Qualified Leads.First Service Date} | Inspected | Blocked |
| Field Update Action | Visit_Module | Set Delivery Date | No | Delivery_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Visit_Module | Set Payment Date | No | Cost_Approval_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Visit_Module | Set Completion Date | No | Completion_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Deals | Add First Install Actual End Date | Yes | Actual_End_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Deals | Add Actual Installation Start Date | Yes | Actual_installation_start_date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Contacts | Lead drop Date | Yes | Lead_Drop_Date = ${EXECUTION_TIME}+0 | Specified | Blocked |
| Field Update Action | Leads | Add Current Owner | Yes | Current_Owner = [object Object] | Specified | Blocked |
| Field Update Action | Deals | Design Approved Date | Yes | Design_Approved_Date = ${EXECUTION_TIME}+0 | Specified | Blocked |
| Field Update Action | Deals | Update send for Approval | Yes | Send_For_Approval_Date = ${EXECUTION_TIME}+0 | Specified | Blocked |
| Field Update Action | Contacts | Set True Sync Status | No | Order_Sync_In_Progress = true | Specified | Blocked |
| Field Update Action | Deals | Update | Yes | Form_Filled_Date_Time = ${EXECUTION_TIME}+0 | Specified | Blocked |
| Field Update Action | Leads | Team Mumbai | Yes | Teams = Team Mumbai | Specified | Blocked |
| Field Update Action | Contacts | Team Mumbai | Yes | Teams = Team Mumbai | Specified | Blocked |
| Field Update Action | Leads | Ai call empty | Yes | AI_Call = false | Specified | Blocked |
| Field Update Action | Contacts | Team - Kirti Nagar | Yes | Teams = Team Kirti Nagar | Specified | Blocked |
| Field Update Action | Contacts | Team - Sultanpur | Yes | Teams = Team Sultanpur | Specified | Blocked |
| Field Update Action | Contacts | Team - Mohali | Yes | Teams = Team Mohali | Specified | Blocked |
| Field Update Action | Contacts | Team - Hyderabad | Yes | Teams = Team Hydrabad | Specified | Blocked |
| Field Update Action | Contacts | Team - Surat | Yes | Teams = Team Surat | Specified | Blocked |
| Field Update Action | Leads | Team Sultanpur | Yes | Teams = Team Punjab | Specified | Blocked |
| Field Update Action | Leads | Set Surat Team | Yes | Teams = Team Hydrabad | Specified | Blocked |
| Field Update Action | Contacts | WOn | Yes | Client_Status = Won | Specified | Blocked |
| Field Update Action | Contacts | Actual Closure | Yes | Actual_Closure_Date = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Contacts | set lead qualified date | Yes | Lead_Qualified_Date1 = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Leads | set lead creation time - test | Yes | Old_Created_Time = ${EXECUTION_DAY}+0 | Specified | Blocked |
| Field Update Action | Contacts | client Status | Yes | Client_Status = Drop | Specified | Blocked |
| Field Update Action | Leads | Team Kirti Nagar | Yes | Teams = Team Kirti Nagar | Specified | Blocked |
| Field Update Action | Leads | Team Mohali | Yes | Teams = Team Surat | Specified | Blocked |
| Field Update Action | Leads | Team- Hyndrabad | Yes | Teams = Team Delhi | Specified | Blocked |
| Field Update Action | Leads | Team- Palash | No | Teams = Team Hydrabad | Specified | Blocked |
| Field Update Action | Contacts | PSM- Anushka | Yes | Sales_Manager = [object Object] | Specified | Blocked |
| Field Update Action | Contacts | PSM - Sowmya | Yes | Sales_Manager = [object Object] | Specified | Blocked |
| Field Update Action | Contacts | PSM - Vaishnavi | Yes | Sales_Manager = [object Object] | Specified | Blocked |
| Field Update Action | Contacts | PSM - Rahul Mahajan | Yes | Sales_Manager = [object Object] | Specified | Blocked |
| Field Update Action | Contacts | PSM - Rahul Mehemi | Yes | Sales_Manager = [object Object] | Specified | Blocked |
| Field Update Action | Contacts | PSM- Pooja | Yes | Sales_Manager = [object Object] | Specified | Blocked |
| Field Update Action | Leads | Disposition | No | Lead_Disposition = Drawings Received | Specified | Blocked |
| Field Update Action | Leads | Priority | No | Lead_Type = Hot | Specified | Blocked |
| Task Action | Deals | Pending Requirement From Designer | Yes | 5 field mappings | Specified | Blocked |
| Task Action | Leads | d | Yes | 4 field mappings | Specified | Blocked |
| Task Action | Leads | Follow up Call | Yes | 4 field mappings | Specified | Blocked |
| Task Action | Tasks | Task Creation | Yes | 6 field mappings | Specified | Blocked |
| Task Action | Leads | Follow up task for ${Raw Leads.Follow Up Type} | Yes | 5 field mappings | Specified | Blocked |
| Task Action | Leads | Urgent: New Lead ${Raw Leads.Lead Name}, Please Call | Yes | 5 field mappings | Specified | Blocked |
| Task Action | Leads | Follow up Call to ${Raw Leads.Lead Name}, Status -  ${Raw Leads.Lead Status} | No | 5 field mappings | Specified | Blocked |
| Task Action | Leads | Contact Email Clicked Lead ${Raw Leads.Company} | Yes | 4 field mappings | Specified | Blocked |
| Task Action | Leads | Contact Email Opened Lead | Yes | 4 field mappings | Specified | Blocked |
| Task Action | Tasks | Reminder task for - ${Tasks.Subject} | Yes | 5 field mappings | Specified | Blocked |
| Task Action | Tasks | Reminder for deferred task - ${Tasks.Subject} | Yes | 5 field mappings | Specified | Blocked |
| Task Action | Leads | Recontact- ${Raw Leads.Last Name} for ${Raw Leads.Company} | No | 4 field mappings | Specified | Blocked |
| Task Action | Leads | Task to re-attempt - ${Raw Leads.Last Name} | No | 4 field mappings | Specified | Blocked |
| Task Action | Leads | Follow up - ${Raw Leads.Last Name} for ${Raw Leads.Company} | No | 5 field mappings | Specified | Blocked |
| Email Notification Action | Contacts | vali | No | Not Validated since 2 Hours | Specified | Blocked |
| Email Notification Action | Deals | Query to SM | Yes | Query to SM | Specified | Blocked |
| Email Notification Action | Deals | Send For Approval | Yes | Order Approval Request | Specified | Blocked |
| Email Notification Action | Deals | Send for Approval Email | Yes | Order Approval Request | Specified | Blocked |
| Email Notification Action | Leads | Thank You Follow-Up Message - Client | No | Thank You For Follow-Up | Specified | Blocked |
| Email Notification Action | Deals | Big Deal Alert | Yes | Big Deal Alert | Specified | Blocked |
| Webhook | Leads | leads_not_interested_pricetoohigh | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Contacts | opp_design_formm | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Contacts | opp_design_if_approved | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Contacts | Opp_intro | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Contacts | opp_revision_appoval | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Contacts | opp_design_revision | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Contacts | opp_design_approval | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | open_no_response_followupcall | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | leads_prospect_experincecenter_vist | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | new_lead_callscheduled | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | new_leads | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | leads_prospect_mess1 | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | leads_future_prospect | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | lead_not_interested_timlinecrunch | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | lead_not_interested_rnr | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | Priya  AI - Sync Lead | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | New_lead_message | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | Prospect_Whatsapp_First | Yes | POST; workflow | Inspected | Blocked |
| Webhook | Leads | First_Call_Attempt | Yes | POST; workflow | Inspected | Blocked |
| Function |  | set Est. Dates | Yes | crm; setestdates | Specified | Blocked |
| Function |  | Update the AMS Date | Yes | crm; updateservicedates1 | Specified | Blocked |
| Function |  | Update the AMS Date | Yes | crm; updateservicedates | Specified | Blocked |
| Function |  | Mark Done Visit | Yes | crm; markdonevisit | Specified | Blocked |
| Function |  | Add Sunrooof Files in the Workdrive | Yes | crm; addsunroooffilesinworkdrive1 | Specified | Blocked |
| Function |  | Add Sunrooof Files in Workdrive | Yes | crm; addsunroooffilesinworkdrive | Specified | Blocked |
| Function |  | Create Won Recoad in Books | Yes | crm; createwonrecoadinbooks | Specified | Blocked |
| Function |  | Fetch TimePay Calls Recoads | Yes | crm; fetchtimepaycallrecoads | Specified | Blocked |
| Function |  | Initiate Calls on TimePay | Yes | crm; initiatecallsontimepay | Specified | Blocked |
| Function |  | Update Done Services Count | Yes | crm; updatedoneservicescount | Specified | Blocked |
| Function |  | totalRevision | Yes | crm; totalrevision | Specified | Blocked |
| Function |  | Daily AMS Auto Transition | Yes | crm; dailyamsautotransition | Specified | Blocked |
| Function |  | Sync Sunrooof Attachments | Yes | crm; syncsunrooofattachments | Specified | Blocked |
| Function |  | Update Data Magppie to Sunrooof | Yes | crm; updatedatamagppietosunrooof | Specified | Blocked |
| Function |  | Sync Magppie To Sunrooof | Yes | crm; createdealinsunrooof1 | Specified | Blocked |
| Function |  | Check Is Sunrooof | Yes | crm; checkissunrooof | Specified | Blocked |
| Function |  | Create Token | Yes | crm; createtoken | Specified | Blocked |
| Function |  | update Post Design area | Yes | crm; updatepostarea | Specified | Blocked |
| Function |  | Create Deal in Sunrooof | Yes | crm; createdealinsunrooof | Specified | Blocked |
| Function |  | Create Access and Refresh Token | Yes | crm; accessrefreshtoken | Specified | Blocked |
| Function |  | Update Expected Order Closing Date | Yes | crm; excpectedclosingdate | Specified | Blocked |
| Function |  | downloadAttachment | Yes | crm; downloadattachment | Specified | Blocked |
| Function |  | Find Duplicate Leads and Opp | Yes | crm; findduplicateleadsandopp | Specified | Blocked |
| Function |  | Update Expected Closing Date Change Counter | Yes | crm; update_expected_closing_date_change_counter | Specified | Plan adapter eligible; writes blocked |
| Function |  | Add Lead Transfer Info | Yes | crm; addleadtransferinfo | Specified | Blocked |
| Function |  | Update Opp Stage - Form Filled | Yes | crm; updateoppstageformfilled | Specified | Blocked |
| Function |  | test button | Yes | crm; test_button | Specified | Blocked |
| Function |  | Sync Order Value With Opp | Yes | crm; sync_order_value_with_opp | Specified | Blocked |
| Function |  | Sync Attachments with Orders | Yes | crm; sync_attachments_with_orders | Specified | Blocked |
| Function |  | set Call Duration In Mints In Bulk | Yes | crm; test | Specified | Blocked |
| Function |  | addAttachmentsinProjects | Yes | crm; addattachmentsinprojects | Specified | Blocked |
| Function |  | updateDesignerName | Yes | crm; updatedesignername | Specified | Blocked |
| Function |  | updateRevisionCount | Yes | crm; updaterevisioncount | Specified | Blocked |
| Function |  | change blueprint | Yes | crm; change_blueprint | Specified | Blocked |
| Function |  | Update Status of Project In Opportuinity | Yes | crm; updatestatus | Specified | Blocked |
| Function |  | createAccounts | Yes | crm; createaccounts | Specified | Blocked |
| Function |  | updateManagementDiscount | Yes | crm; updatemanagementdiscount | Specified | Blocked |
| Function |  | Increase Revision Count | Yes | crm; increase_revision_count1 | Specified | Blocked |
| Function |  | Create Project | Yes | crm; createproject | Specified | Blocked |
| Function |  | Carry forward tax | Yes | crm; carryforwardtax | Specified | Blocked |
| Function |  | Update Milestone Status | Yes | crm; updatemilestonestatus | Specified | Blocked |
| Function |  | updateMilestones | Yes | crm; updatemilestones_1 | Specified | Blocked |
| Function |  | createNextMilestone | Yes | crm; createnextmilestone | Specified | Blocked |
| Function |  | Update Milestones Based on order value | Yes | crm; updatemilestones | Specified | Blocked |
| Function |  | Create / Update Sales Order | Yes | crm; createupdatesalesorder | Specified | Blocked |
| Function |  | Opportunity to Project Update | Yes | crm; opptoprojectupdate | Specified | Blocked |
| Function |  | Increase Revision Count | Yes | crm; increase_revision_count | Specified | Blocked |
| Function |  | Amount Recieved < Amount Paid | Yes | crm; amount_recieved | Specified | Blocked |
| Function |  | Update Note In Opportunity | Yes | crm; updatenoteinopportunity1 | Specified | Blocked |
| Function |  | opp to Project | Yes | crm; opp_to_project | Specified | Blocked |
| Function |  | Project Creation And Updation | Yes | crm; create_project | Specified | Blocked |
| Function |  | Add Country Code With Remove Duplicate | Yes | crm; addcountrycodewithremoveduplicate | Specified | Blocked |
| Function |  | Set Call Duration In Minutes | Yes | crm; setcalldurationinminutes | Specified | Blocked |
| Function |  | Update Note In Opportunity | Yes | crm; updatenoteinopportunity | Specified | Blocked |
| Function |  | Update Note In Lead | Yes | crm; udpatenoteinlead | Specified | Blocked |
| Function |  | Create Note in Opportunity | Yes | crm; createnoteinopportunity | Specified | Blocked |
| Function |  | Create Note From Desc | Yes | crm; createnotefromdesc | Specified | Blocked |
| Function |  | Create Ticket Services Management | Yes | crm; createticketservicemanagement | Specified | Blocked |
| Function |  | Set PSM User | Yes | crm; set_psm_user | Specified | Blocked |
| Function |  | Create_lead | Yes | crm; create_lead | Specified | Blocked |
| Blueprint | Leads | Lead nurturing process | Yes | State transition | Inspected | Blocked |
| Assignment Rule | Leads | Scanner Leads | Yes | Assignment | Inspected | Not Inspected |
| Blueprint | Contacts | Opportunity Stage | Yes | State transition | Inspected | Blocked |
| Blueprint | Tasks | Task Process Management | Yes | State transition | Inspected | Blocked |
| Blueprint | Deals | Order Stages | Yes | State transition | Inspected | Blocked |
| Blueprint | Visit_Module | Installation Visit Flow | Yes | State transition | Inspected | Blocked |
| Blueprint | AMS_Complaints | Complaint Flow - Installation | Yes | State transition | Inspected | Blocked |
| Blueprint | AMS_Complaints | AMS/Complaint Flow | Yes | State transition | Inspected | Blocked |
