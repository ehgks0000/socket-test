## DONE

1. 사용자 생성 3명 /user/create?name=1
2. Dm 보내기 /user/:id/dm/:receiverId?message=test
   1. 1->2 2번
   2. 2->1 3번
   3. 1->2 1번
3. DMs 가져오기 /user/:id/dms/:receiverId
4. 채팅방 생성 (오너) /user/:id/room/create?title=1room
   1. 1번이 1개
   2. 2번이 1개
5. 전체 채팅방 조회 /rooms?take=10&cursor=1
6. 특정 채팅방 조회
   1. 채팅방 아이디로 (1) /room-id/:id
   2. 채팅방 제목으로 (1room) /room?title=asdf error
7. 채팅방 참여 /user/:id/room/:roomId/join
   1. 2번이 1번의 채팅방 참여
   2. 3번이 1번의 채팅방 참여
8. 채팅방에서 채팅 (1번의 채팅방에서)
   1. 1번이 채팅 1번 /chat/user/:id/room/:roomId?message=asdf1
   2. 2번이 채팅 2번
   3. 3번이 채팅 1번
9. 특정 채팅방의 유저 리스트
   1. 1번 채팅방 유저 리스트 /room/:id/users -> 최신 들어온 유저순?

## DONE 2
* 22-10-11

1. 팔로우 하기
2. 팔로우 취소하기
4. 내 팔로워 보기
5. 내 팔로잉 보기
6. 팔로워 밴

## TODO

1. 유저 수정
2. 유저 삭제
3. Dm 삭제
4. 채팅방 삭제
5. 채팅방 수정
6. 채팅방의 chat 삭제(수정?)
   1. 유저가 chat 삭제
   2. 방장이 chat 삭제
7. 채팅방 나가기
   1. 유저가 채팅방 나가기
   2. 방장이 유저 강퇴
8. 밴에 대한 리스트(테이블)(팔로워 밴, 채팅방 밴)
9. 로그 테이블 만들기

### ???

f에서 5초마다 login emit data = {userId: "my user id"}

b에서 f의 emit이 6번(30초 이상) 안오는 경우 user status offline으로 변경.
