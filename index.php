<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("function.php");
require_once("Session.php");
require_once("Manual.php");
require_once("category.php");
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$allCategories = Category::find_all();
$allManuals = Manual::find_all();
?>

<div class="container-fluid">
 	<div class="row-fluid">
    	<div class="span2">
			<ul class="nav nav-list navMenu">
			 	<li class="nav-header">
			 		Toastmasters Library
			 	</li>
				<li>
					<a href="logout.php">Logout</a>
				</li>
			 	<li class="nav-header">
			 		Navigation
			 	</li>
			 	<?php
					if($SESS->userRoleId == ADMIN_USER)
					{
			 	?>
					<li>
						<a href="sandbox.php">Sandbox</a>
					</li>
					<li>
						<a href="settings.php">Settings</a>
					</li>
			 	<?php
			 		}
			 	?>
				<li class="dropdown">
					<a class="dropdown-toggle" id="manualDropDown" data-toggle="dropdown" href="#">
						Manuals <b class="caret"></b>
					</a>
					<ul id="manualDropDownMenu" class="dropdown-menu" role="menu" area-labelledby="manualDropDown">
						<?php
							if(!is_null($allManuals)){
								foreach($allManuals as $aManual){
									echo "<li>";
									echo "<a tabindex=\"-1\" href=\"viewCategory.php?id=" . $aManual->id . "\">" . $aManual->description ."</a>";
									echo "</li>";	
								}
							} else{
								echo "<li>";
								echo "<a tabindex=\"-1\" href=\"#\">No Categories</a>";
								echo "</li>";
							}
						?>
					</ul>

				</li>
			</ul>
    	</div>
	    <div class="span10">
	    	<div class="page-header">
			  <h1 style="text-align:center;">Welcome to The Toastmasters Library!</h1>
			</div>
			<ul class="thumbnails">
			  <li style="min-height:720px">
		    	<div id="photoRotator">
		    		<div id="current">
		     			<img src="TMCOVE1.jpg" data-src="holder.js/360x270" >
		      		</div>
		    		<div>
		     			<img src="TMCOVE2.jpg" data-src="holder.js/360x270" >
		      		</div>
		    		<div>
		     			<img src="TMCOVE3_C.jpg" data-src="holder.js/360x270" >
		      		</div>
		      	</div>
			  </li>
			</ul>		
	    </div>
  	</div>
</div>

<script>
	$(function(){
		setInterval("rotateImages()", 2000);
	});

	function rotateImages(){
		var currentPhoto = $('#photoRotator div.current');
		var nextPhoto = currentPhoto.next();

		if(nextPhoto.length == 0){
			nextPhoto = $('#photoRotator div:first');
		}

		currentPhoto.removeClass('current').addClass('previous');
		nextPhoto.css({opacity:0.0}).addClass('current').animate({opacity:1.0}, 1000, 
			function(){
				currentPhoto.removeClass('previous');
			});
	}
</script>


<?php
include_once("footer.php");
?>

