<?php
// function redirect_to($newLoc = ""){
// 	if($newLoc != null){
// 		header("Location: $newLoc");
// 		exit;
// 	}
// }
function redirect_to($newLoc = "", $kickoutStatus = null, $flashMessage = null){
	if($newLoc != null){
		header("Location: $newLoc?kickoutStatus=$kickoutStatus&flashMessage=$flashMessage");
		exit;
	}
}

?>