# Property Management System - Client Feature Document

This document lists the client-facing features available in the project. It focuses on business value, daily workflows, and operational capabilities, not on the internal technology used to build the system.

## Executive Summary

The system is a complete property operations platform for managing apartments, reservations, availability, guests, access codes, cleaning, maintenance, finances, reports, receipts, invoices, and booking-channel synchronization.

It helps the client run daily operations from one place: see what is happening today, find available apartments, create and edit bookings, track payments, manage apartment details, coordinate cleaning, follow maintenance issues, monitor revenue, produce reports, and keep Airbnb and Booking.com calendars aligned.

The platform also supports separate business workspaces, including AirStay for apartment operations and Fleet for vehicle-style operations. Labels and reporting language adapt based on the selected workspace.

## User Access And Permissions

The system includes secure sign-in and role-based access so each staff member sees the tools relevant to their work.

- Admin users can access all operational, financial, reporting, receipt, synchronization, and user-management tools.
- Management staff can manage daily operations such as reservations, availability, calendar, properties, codes, maintenance, archive, synchronization, and invoices.
- Cleaning staff receive a simplified operational view focused on cleaning tasks, access information, and maintenance reporting.
- Admins can create new user accounts, assign roles, activate or deactivate accounts, and update passwords.
- Users can log out securely from the application.

## Main Dashboard

The dashboard gives the client a quick daily overview of the business.

- Select any report date to review operations for that day.
- See all check-ins, check-outs, and current guest stays.
- View free apartments for the selected date.
- See each free apartment's next check-in date and number of available nights.
- Track whether each free apartment is cleaned or still needs cleaning.
- View upcoming reservations with guest, apartment, dates, nights, payment status, platform, and quick actions.
- Open reservation details or generate an invoice directly from upcoming bookings.
- Add a new reservation from the dashboard.
- Admin users see key portfolio metrics such as turnover, booked nights, free nights, and occupancy.

## Cleaning Dashboard

Cleaning staff get a focused dashboard designed for daily execution.

- See today's check-ins, check-outs, currently hosted guests, and free apartments.
- Review which apartments are free and when the next guest arrives.
- Mark apartments as cleaned after work is complete.
- See cleaning status in a simple task-oriented format.
- Check operational movement without exposing financial or administrative tools.

## Availability Search

The availability search helps staff quickly answer guest inquiries.

- Search by check-in date, check-out date, and bedroom count.
- Find apartments available for the full requested stay.
- See available apartments with photo, apartment type, and base nightly price.
- Start a booking directly from an available apartment result.
- If no single apartment is available for the whole stay, receive split-stay recommendations.
- Split-stay recommendations show which apartments can cover each part of the guest's dates.
- Book each recommended stay segment directly.
- View matching apartments on a timeline calendar.
- Move the timeline forward, backward, or back to the searched date range.
- Click calendar dates to create a reservation for a selected range.
- Click existing reservations from the timeline to edit them.

## Smart Reservation Search

The system includes a dedicated search page for quickly finding bookings.

- Search across all reservations by guest name, phone number, apartment, date, platform, amount, or notes.
- Search accepts partial information such as "May 2024" or a rounded payment amount.
- Typo-tolerant matching helps find reservations even when the search text is not exact.
- Results show guest details, apartment, check-in, check-out, number of nights, platform, payment status, and notes.

## Reservation Management

The reservations area is a spreadsheet-style workspace for managing bookings.

- Filter reservations by year, month, apartment, and booking platform.
- Search within the current reservation list by guest, phone, apartment, platform, date, or notes.
- Add reservations directly in the table.
- Edit guest name, phone number, payment due date, paid status, booking source, apartment, check-in, check-out, nightly price, total price, and notes.
- Reservation changes auto-save once required information is complete.
- Number of nights is calculated automatically from check-in and check-out dates.
- Total price can be calculated from nightly price, or nightly price can be calculated from total price.
- Airbnb, Booking.com, private, and maintenance reservations are supported.
- Maintenance blocks can be entered without guest details.
- Reservation rows can be sorted by any main column.
- Paste reservation rows from a spreadsheet into the system.
- Pasted data can match apartments by name or apartment number.
- Imported rows calculate nights and pricing automatically where possible.
- Temporary discount percentage and discounted total fields help staff quote adjusted prices without changing the saved reservation.
- Export filtered reservations to CSV for spreadsheet use.
- Print the reservation table or save it as a PDF.
- Delete all reservations for the selected month when needed.
- Archive individual reservations instead of immediately destroying them.
- Open a printable invoice directly from a reservation.
- Upload and manage reservation attachments such as documents, screenshots, IDs, confirmations, or receipts.
- The system prevents normal guest reservations from overlapping on the same apartment.

## Reservation Archive

Deleted reservations are handled safely through an archive.

- Deleted reservations move to the archive instead of disappearing immediately.
- Archived reservations are kept for 30 days.
- Staff can restore archived reservations.
- Staff can permanently delete archived reservations when needed.
- The archive shows guest, apartment, platform, dates, total amount, archive date, and days remaining before auto-delete.
- Reservations close to permanent removal are visually highlighted.

## Calendar Management

The calendar gives staff a visual way to understand occupancy and create bookings.

- View all listings in a multi-day timeline.
- Search listings by apartment name, apartment number, bedroom count, or apartment type.
- Filter the calendar by bedroom count.
- Sort listings by apartment number, name, or bedrooms.
- Jump directly to a month.
- Move the visible calendar range forward or backward.
- Return quickly to today.
- See booking bars across dates for each apartment.
- Booking colors distinguish reservation sources such as Airbnb, Booking.com, private bookings, and maintenance.
- View daily base prices directly inside the calendar.
- Click an empty date, then another date on the same apartment, to create a reservation for that range.
- Click an existing reservation to edit or delete it.
- Open a single-apartment monthly calendar view.
- Navigate between months and years in the single-apartment calendar.
- Use mouse wheel movement in the single-apartment calendar to move between months.

## Property And Listing Management

The properties page lets the client maintain the apartment portfolio.

- View all active listings in a visual card layout.
- Add new properties.
- Edit existing property details.
- Remove properties from active listings.
- Store property name, bedroom count, floor, nightly price, address, Wi-Fi name, Wi-Fi password, and photo.
- Preview property photos before saving.
- View listing status as listed or unlisted.
- Open a property detail modal with all key information.
- See Wi-Fi details from the property profile.
- Use property data throughout reservations, availability, reports, cleaning, codes, and synchronization.

## Access Codes

The system centralizes apartment access information.

- Manage door codes for each active apartment.
- View old code, current code, date changed, floor, Wi-Fi name, Wi-Fi password, and notes.
- Save updated door codes and notes.
- See reminders when a code has not been changed since the last checkout.
- Copy apartment access information to the clipboard for fast sharing with staff or guests.
- Manage lockbox codes separately from apartment door codes.
- Add new lockboxes.
- Edit lockbox name, apartment reference, current code, and notes.
- Delete lockboxes that are no longer used.
- Copy lockbox information to the clipboard.

## Maintenance And Repairs

The "To Fix" area helps staff track apartment issues.

- View open maintenance issues grouped by apartment.
- See how many issues are open across the portfolio.
- Sort apartments by name or by number of issues.
- Expand each apartment to view reported issues.
- Report a new issue for any apartment.
- Add a description, reporter name, and optional photos.
- View issue photos inside the issue card.
- Remove individual issue photos.
- Delete completed or invalid maintenance issues.
- Cleaning staff can report issues without needing access to financial or admin tools.

## Needs Attention

The Needs Attention page highlights items that require staff follow-up.

- Detect imported Airbnb or Booking.com reservations that are missing guest details or pricing.
- Fill in missing guest name, phone number, and nightly price directly from the page.
- Mark corrected imported reservations as saved.
- Detect overlapping reservations for the same apartment.
- Show conflict groups by apartment with guest, source, check-in, check-out, and total amount.
- Provide an "all clear" status when there are no incomplete imports or conflicts.

## Booking Channel Synchronization

The synchronization area helps connect the PMS with external booking channels.

- Store Airbnb calendar links for each apartment.
- Store Booking.com calendar links for each apartment.
- Show whether each apartment is fully connected, partially connected, or missing links.
- Display totals for connected, partial, and missing synchronization setups.
- Save synchronization settings per apartment.
- Turn auto-sync on or off per apartment.
- Choose an auto-sync interval in hours.
- Manually sync Airbnb reservations for an apartment.
- Manually sync Booking.com reservations for an apartment.
- See sync results such as imported, updated, skipped, and error counts.
- View PMS calendar export links that can be shared with external calendar systems.
- Review sync history per apartment.
- Sync history shows channel, status, imported count, updated count, skipped count, conflicts, and time.

## Performance Reports

The reports area gives the client a clear view of business performance.

- View performance monthly, yearly, or all time.
- Filter reports by year, month, and apartment.
- View all apartments or a single apartment.
- Exclude selected apartments from statistics.
- Export reports to PDF using print.
- Track turnover, reservation count, booked nights, free nights, occupancy, and average nightly price.
- Sort apartment performance by apartment name, reservations, booked nights, free nights, occupancy, average nightly price, or turnover.
- Show the top apartments first or expand to view all apartments.
- View monthly revenue charts for the selected year.
- Compare two apartments side by side.
- See which apartment performs better for turnover, reservations, booked nights, occupancy, and average nightly price.
- View a revenue comparison chart between two apartments.
- View a yearly monthly breakdown for a selected apartment.
- Track daily occupancy trends for any month and year.
- Analyze stay duration groups such as 0-1 day, 2-6 days, 7-14 days, 15-27 days, and 28+ days.
- See how much revenue each stay-duration group contributes.
- Identify the lowest-performing apartment in each bedroom category.

## Finance Management

The finance page gives admins a monthly financial control center.

- Select any month and year for financial review.
- View financial results for the selected business workspace.
- Track turnover, expenses, profit, loan payments, profit after loans, taxes, net profit, and total debt.
- Export the finance view to PDF using print.
- Create expense categories.
- Assign colors to expense categories for charts.
- Rename expense categories.
- Delete unused expense categories.
- Add one-time expenses.
- Add repeated expenses with start and end periods.
- Assign expenses to AirStay, Fleet, or shared business use.
- Edit existing expenses.
- Delete expenses.
- Exclude selected categories from charts and financial view calculations.
- View a yearly monthly expenses chart by category.
- Add loans with monthly value and start/end periods.
- Track active loans for the selected month.
- Delete loans.
- Add financial obligations such as supplier debts or unpaid company balances.
- Track obligation company, description, due date, paid status, and amount.
- Mark obligations as paid or unpaid.
- Delete obligations.
- Record monthly VAT/TVSH.
- Record monthly profit tax.
- Add notes to tax records.
- View tax history across months.
- Clear tax records when needed.

## Receipts And Deposits

The receipts page helps admins reconcile daily receipts and deposits.

- Select month and year for receipt tracking.
- View daily receipt totals for the selected month.
- Track total receipts, total deposited, and amount left to deposit.
- Enter deposit amount per day.
- Mark whether a receipt was left.
- Add daily notes.
- Open a detailed receipt view for any day.
- Add multiple receipt items to a day.
- Enter receipt value and notes per receipt item.
- Link receipt items to reservations from the same month.
- Prevent already-linked reservations from being accidentally reused.
- See linked guest, apartment, dates, and paid amount.
- Compare receipt value against linked reservation payments.
- Highlight differences between receipt value and reservation paid totals.
- Delete receipt items.
- Save day-level deposit and receipt-left status.
- Auto-save quick daily edits from the monthly table.

## Invoice Generation

The invoice page creates printable invoices from reservations.

- Open an invoice directly from a reservation.
- Store and reuse company information such as company name, business ID, address, phone, and email.
- Edit invoice company information.
- Fill in client name, business ID, address, and phone.
- Generate an invoice number automatically.
- Edit invoice number and invoice date.
- Show accommodation line item with apartment, apartment type, check-in, check-out, nights, nightly rate, and amount.
- Override the invoice total if needed.
- Calculate price without VAT, 18% VAT, and total amount.
- Add invoice notes such as payment instructions or messages.
- Print the invoice or save it as a PDF.

## Multi-Workspace Support

The system supports more than one operational workspace.

- Switch between AirStay and Fleet from the sidebar.
- AirStay uses apartment-focused labels and workflows.
- Fleet uses vehicle-style labels where appropriate, such as cars instead of apartments.
- Reports and finance adapt to the selected workspace.
- Records are separated by workspace where relevant, so each business can be reviewed independently.

## Operational Quality Features

The system includes several safeguards and workflow helpers that improve day-to-day reliability.

- Reservation overlap checks reduce double-booking risk.
- Imported reservations with missing details are flagged for correction.
- Reservation deletion is recoverable through the archive.
- Access-code reminders help staff know when codes should be changed.
- Cleaning status keeps staff aligned before the next arrival.
- Receipt reconciliation helps compare cash receipts against booked revenue.
- Sync logs provide visibility into what was imported or skipped.
- Role-based access limits sensitive financial and administrative areas to the right people.

## Client Value

For the client, the system provides one central place to run short-term rental operations:

- Faster reservation entry and editing.
- Better visibility into daily arrivals, departures, and free apartments.
- Easier communication of door, lockbox, and Wi-Fi information.
- Cleaner coordination between management and cleaning staff.
- Safer handling of deleted reservations.
- Better detection of incomplete imports and booking conflicts.
- Clearer financial control over expenses, loans, obligations, taxes, and net profit.
- Stronger reporting for occupancy, turnover, pricing, apartment comparison, and long-term performance.
- Easier reconciliation of receipts and deposits.
- Printable invoices and reports for administration or client records.
- Better calendar alignment with Airbnb and Booking.com.
