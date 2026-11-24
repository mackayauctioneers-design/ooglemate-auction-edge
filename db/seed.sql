-- Example data for drafts: three yards, a few desk cars each, and the yard/owner links.
INSERT INTO public.accounts (id, slug, display_name) VALUES
 ('d24da4ea-f500-47fd-9b66-d2c9aa2d3f51','mackay-traders','Mackay Traders'),
 ('8140eae1-2c36-40b6-a358-4f5ed05bbbcf','ajh-auto-traders','AJH Auto Traders'),
 ('a2aec451-3b68-47f1-aaa8-ce7ef470b30d','the-wholesale-shed','The Wholesale Shed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.operator_opportunities (listing_id, listing_source, make, model, year, km, asking_price, best_account_id, best_account_name, tier, status) VALUES
 ('example-mk-1','pickles','Toyota','Hilux',2019,98000,31500,'d24da4ea-f500-47fd-9b66-d2c9aa2d3f51','Mackay Traders','BUY','new'),
 ('example-mk-2','carsales','Ford','Ranger',2020,76000,34900,'d24da4ea-f500-47fd-9b66-d2c9aa2d3f51','Mackay Traders','WATCH','new'),
 ('example-ajh-1','manheim','Mazda','CX-5',2018,88000,19800,'8140eae1-2c36-40b6-a358-4f5ed05bbbcf','AJH Auto Traders','BUY','new'),
 ('example-shed-1','gumtree','Nissan','Navara',2017,140000,17500,'a2aec451-3b68-47f1-aaa8-ce7ef470b30d','The Wholesale Shed','WATCH','new'),
 ('example-none-1','autotrader','Kia','Sportage',2021,45000,26900,NULL,NULL,'WATCH','new');

INSERT INTO public.yard_links (ooglecars_dealership_id, account_id) VALUES
 ('00000000-0000-0000-0000-000000000001','d24da4ea-f500-47fd-9b66-d2c9aa2d3f51'),
 ('fd2c6829-322c-44d9-b643-e13ccb7ea6e8','8140eae1-2c36-40b6-a358-4f5ed05bbbcf'),
 ('927f7168-b8ef-4ba4-a0c3-6e4687463d9b','a2aec451-3b68-47f1-aaa8-ce7ef470b30d')
ON CONFLICT DO NOTHING;

INSERT INTO public.owner_access (ooglecars_user_id, note) VALUES
 ('ecaa43a6-8433-4b4e-816e-f2b081e5903d','Owner, all yards, 25 Nov')
ON CONFLICT DO NOTHING;
