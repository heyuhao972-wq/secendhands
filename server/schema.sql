-- =========================
-- 区块表：唯一真相来源
-- =========================
create table blocks
(
    block_index  bigint      not null
        primary key,
    prev_hash    char(64)    not null,
    block_hash   char(64)    not null,
    timestamp    bigint      not null,
    type         varchar(32) not null,
    payload_json json        not null
);


-- =========================
-- 交易状态缓存表,根据区块链表更新
-- =========================
create table trades
(
    trade_id           varchar(64)                        not null
        primary key,
    seller_pubkey      text                               not null,
    buyer_pubkey       text                               null,
    status             varchar(16)                        not null,
    content_hash       varchar(64)                        not null,
    created_at         datetime default CURRENT_TIMESTAMP not null,
    updated_at         datetime default CURRENT_TIMESTAMP not null on update CURRENT_TIMESTAMP,
    seller_chat_pubkey text                               null,
    buyer_chat_pubkey  text                               null,
    description        text                               null,
    price              varchar(64)                        null
);




-- =========================
-- 聊天密文缓存，根据交易状态删除
-- =========================
create table chats
(
    trade_id          varchar(64) not null,
    buyer_chat_pubkey varchar(64) not null,
    sender_pubkey     varchar(64) not null,
    ciphertext        text        not null,
    timestamp         bigint      not null,
    id                int         null,
    primary key (trade_id, buyer_chat_pubkey, timestamp)
);
