<?php
function redirect_to($newLoc = ""){
	if($newLoc != null){
		header("Location: $newLoc");
		exit;
	}
}

?>